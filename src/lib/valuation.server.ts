import type { Prisma, PrismaClient, ValuationStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadProjectMoney } from '@/lib/money.server'
import { loadScope, loadApprovedProgress, evAcAsOf } from '@/lib/evm.server'
import { MONEY_DP } from '@/lib/evm'
import { round } from '@/lib/budget'
import {
  computePeriod, deriveValuationCumulative, periodEnd,
  type PeriodFigures, type ValuationActivityInput, type ValuationAssetInput, type ValuationLineFigures,
} from '@/lib/valuation'

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Phase 6D — deriving an interim payment certificate from approved field progress.
 *
 * Revenue is certified off the SAME scope, the SAME approved-progress query and the SAME
 * EV/BV fractions the cost side uses (6C's `loadScope` / `evAcAsOf`), evaluated at the
 * period's month-end via `reportDate`. One path, so revenue and cost can never drift apart —
 * they differ only in what they multiply the fraction by: billRate × BOQ and
 * Asset.lumpsumRevenue on this side, the frozen cost build-up on the other.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v))
const nn = (v: unknown): number | null => (v == null ? null : Number(v))

// ─── Computation ─────────────────────────────────────────────────────────────

export interface ValuationComputation extends PeriodFigures {
  periodMonth: string
  asOf: string
  contractValue: number
  cumulativeMeasured: number
  cumulativeLumpsum: number
  cumulativeGross: number
  previousGross: number
  previousRetentionHeld: number
  advanceRecoveredToDate: number
  lines: ValuationLineFigures[]
}

/**
 * THE definition of "what has been certified": the current certified revision of each period
 * (highest revisionNumber wins — after a re-issue that is the newest certified one), sorted by
 * period ascending. Both 6D's prior-period arithmetic and 6E's receivables depend on this, so
 * there is ONE implementation and they cannot drift.
 *
 * `before` (exclusive) restricts to earlier periods; omit it for the full history. Numbers are
 * already Number-converted at the boundary. Deliberately does NOT filter on invoicedAt or any
 * payment field — a certified period stays certified once paid, which is why 6E must never
 * advance `status`.
 */
export interface CertifiedRevisionRow {
  id: string
  valuationCode: string
  projectId: string
  periodMonth: Date
  revisionNumber: number
  grossAmount: number
  retentionHeld: number
  advanceRecovery: number
  netPayable: number
  expectedReceipt: Date | null
  invoicedAt: Date | null
  certifiedAt: Date | null
}

export async function loadCertifiedRevisionsByPeriod(
  tx: Tx,
  opts: { projectId?: string; before?: Date } = {},
): Promise<CertifiedRevisionRow[]> {
  const rows = await tx.valuation.findMany({
    where: {
      status: 'CERTIFIED',
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.before ? { periodMonth: { lt: opts.before } } : {}),
    },
    orderBy: [{ periodMonth: 'asc' }, { revisionNumber: 'asc' }],
    select: {
      id: true, valuationCode: true, projectId: true, periodMonth: true, revisionNumber: true,
      grossAmount: true, retentionHeld: true, advanceRecovery: true, netPayable: true,
      expectedReceipt: true, invoicedAt: true, certifiedAt: true,
    },
  })

  // One row per period — rows arrive in revisionNumber-ascending order, so the last set wins.
  const byPeriod = new Map<string, (typeof rows)[number]>()
  for (const r of rows) byPeriod.set(r.periodMonth.toISOString().slice(0, 10), r)

  return [...byPeriod.values()]
    .sort((a, b) => a.periodMonth.getTime() - b.periodMonth.getTime())
    .map((r) => ({
      id: r.id, valuationCode: r.valuationCode, projectId: r.projectId, periodMonth: r.periodMonth,
      revisionNumber: r.revisionNumber, grossAmount: n(r.grossAmount), retentionHeld: n(r.retentionHeld),
      advanceRecovery: n(r.advanceRecovery), netPayable: n(r.netPayable),
      expectedReceipt: r.expectedReceipt, invoicedAt: r.invoicedAt, certifiedAt: r.certifiedAt,
    }))
}

/**
 * Prior certified state for a project as of a period — the most recent certified EARLIER
 * period, and the running advance recovered across all of them. Built on the shared helper
 * above so it can never disagree with 6E about which revision is current.
 *
 * "Previous" is the most recent certified earlier period rather than literally last month:
 * with contiguous monthly certificates they are the same, and when a month was skipped this is
 * the only arithmetic that neither double-bills nor loses a period.
 */
async function loadPriorCertified(tx: Tx, projectId: string, periodMonth: Date) {
  const kept = await loadCertifiedRevisionsByPeriod(tx, { projectId, before: periodMonth })
  const last = kept[kept.length - 1]
  return {
    previousGross: last ? last.grossAmount : 0,
    previousRetentionHeld: last ? last.retentionHeld : 0,
    advanceRecoveredToDate: round(kept.reduce((s, r) => s + r.advanceRecovery, 0), MONEY_DP),
  }
}

/**
 * Compute a certificate for `periodMonth` (YYYY-MM-01) from current approved data.
 * Used to create a DRAFT, to recompute one, and to build a re-issued revision.
 */
export async function computeValuation(
  projectId: string,
  periodMonth: string,
  tx: Tx = prisma,
): Promise<ValuationComputation | null> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, retentionPct: true, retentionCapPct: true, advancePct: true },
  })
  if (!project) return null

  const cutoff = periodEnd(periodMonth)
  const [{ subs, assetOrder }, progress, money, prior] = await Promise.all([
    loadScope(projectId),
    loadApprovedProgress(projectId, cutoff),
    loadProjectMoney(projectId),
    loadPriorCertified(tx, projectId, new Date(`${periodMonth}T00:00:00.000Z`)),
  ])
  if (!money) return null

  const { evBySub } = evAcAsOf(subs, progress, cutoff)
  const ev = (id: string) => evBySub.get(id) ?? 0

  // ── measured: group the activity's MEASURED subs, so parallel stage subs on the same BOQ
  //    produce ONE BV-weighted percent rather than a sum of quantities. ──
  const byActivity = new Map<string, ValuationActivityInput & { assetId: string }>()
  const lumpsumByAsset = new Map<string, { ev: number; bv: number }>()
  for (const s of subs) {
    if (s.type === 'MEASURED') {
      const cur = byActivity.get(s.activityId) ?? {
        activityId: s.activityId, type: 'MEASURED' as const, billRate: s.billRate,
        boqQuantity: s.plannedQty, measuredEv: 0, measuredBv: 0, assetId: s.assetId,
      }
      cur.measuredEv = round(cur.measuredEv + ev(s.subActivityId), MONEY_DP)
      cur.measuredBv = round(cur.measuredBv + s.bv, MONEY_DP)
      byActivity.set(s.activityId, cur)
    } else {
      const cur = lumpsumByAsset.get(s.assetId) ?? { ev: 0, bv: 0 }
      cur.ev = round(cur.ev + ev(s.subActivityId), MONEY_DP)
      cur.bv = round(cur.bv + s.bv, MONEY_DP)
      lumpsumByAsset.set(s.assetId, cur)
    }
  }

  const lumpsumRevenueByAsset = new Map(money.assets.map((a) => [a.assetId, a.lumpsumRevenue]))
  const assetInputs: ValuationAssetInput[] = assetOrder.map((a, i) => {
    const pool = lumpsumByAsset.get(a.id) ?? { ev: 0, bv: 0 }
    return {
      assetId: a.id,
      assetName: a.name,
      sortOrder: i,
      lumpsumRevenue: lumpsumRevenueByAsset.get(a.id) ?? null,
      lumpsumEv: pool.ev,
      lumpsumBv: pool.bv,
      activities: [...byActivity.values()].filter((x) => x.assetId === a.id),
    }
  })

  const cumulative = deriveValuationCumulative(assetInputs)
  const period = computePeriod({
    cumulativeGross: cumulative.cumulativeGross,
    previousGross: prior.previousGross,
    contractValue: money.contractValue,
    retentionPct: nn(project.retentionPct),
    retentionCapPct: nn(project.retentionCapPct),
    previousRetentionHeld: prior.previousRetentionHeld,
    advancePct: nn(project.advancePct),
    advanceRecoveredToDate: prior.advanceRecoveredToDate,
  })

  return {
    periodMonth,
    asOf: cutoff.toISOString().slice(0, 10),
    contractValue: money.contractValue,
    ...cumulative,
    previousGross: prior.previousGross,
    previousRetentionHeld: prior.previousRetentionHeld,
    advanceRecoveredToDate: prior.advanceRecoveredToDate,
    ...period,
  }
}

/** The header columns a DRAFT stores — recomputed on every edit, frozen at certify. */
export function computationToHeader(c: ValuationComputation) {
  return {
    progressPct: c.progressPct,
    cumulativeMeasured: c.cumulativeMeasured,
    cumulativeLumpsum: c.cumulativeLumpsum,
    grossAmount: c.cumulativeGross,
    previousGross: c.previousGross,
    retentionHeld: c.retentionHeld,
    advanceRecovery: c.advanceRecovery,
    netPayable: c.netThisPeriod,
  }
}

export function computationToLines(c: ValuationComputation) {
  return c.lines.map((l) => ({
    assetId: l.assetId,
    assetName: l.assetName,
    cumulativeMeasured: l.cumulativeMeasured,
    cumulativeLumpsum: l.cumulativeLumpsum,
    cumulativeGross: l.cumulativeGross,
    sortOrder: l.sortOrder,
  }))
}

// ─── Certification gate ──────────────────────────────────────────────────────

export interface CertifyBlocker {
  kind: 'ACTIVITY_BILL' | 'ASSET_LUMPSUM_REVENUE'
  name: string
  detail: string
}

/**
 * Report approval deliberately does not block on unpriced scope. Issuing a CLIENT certificate
 * that silently under-bills is a different matter — it is a real financial loss — so certify
 * is hard-blocked while any scope would certify at zero. Drafting stays allowed throughout.
 *
 * A null retentionPct / advancePct is not a blocker: the contract simply has none.
 */
export async function certifyBlockers(projectId: string): Promise<CertifyBlocker[]> {
  const money = await loadProjectMoney(projectId)
  if (!money) return []

  const blockers: CertifyBlocker[] = money.unpriced
    .filter((u) => u.kind === 'ACTIVITY_BILL')
    .map((u) => ({
      kind: 'ACTIVITY_BILL' as const,
      name: u.activityName,
      detail: 'Measured activity has no bill rate — it would certify at zero.',
    }))

  for (const asset of money.assets) {
    // "Contains lumpsum scope" = deriveActivityMoney found lumpsum cost on some activity.
    const hasLumpsum = asset.activities.some((a) => a.costSource === 'LUMPSUM' || a.costSource === 'MIXED')
    if (hasLumpsum && asset.lumpsumRevenue == null) {
      blockers.push({
        kind: 'ASSET_LUMPSUM_REVENUE',
        name: asset.assetName,
        detail: 'Asset has lump-sum scope but no agreed lump-sum revenue — it would certify at zero.',
      })
    }
  }
  return blockers
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export interface ValuationLineView extends ValuationLineFigures {
  id: string
  /** This period per asset = this line minus the same asset on the prior certified valuation. */
  measuredThisPeriod: number
  lumpsumThisPeriod: number
  grossThisPeriod: number
}

export interface ValuationView {
  id: string
  valuationCode: string
  projectId: string
  periodMonth: string
  revisionNumber: number
  supersededAt: string | null
  status: ValuationStatus
  progressPct: number
  cumulativeMeasured: number
  cumulativeLumpsum: number
  grossAmount: number
  previousGross: number
  grossThisPeriod: number
  retentionHeld: number
  retentionThisPeriod: number
  advanceRecovery: number
  netPayable: number
  contractValueAtCert: number | null
  retentionPctAtCert: number | null
  advancePctAtCert: number | null
  certifiedAt: string | null
  invoicedAt: string | null // Phase 6E — the manual payment-side mark (not a status transition)
  expectedReceipt: string | null
  createdAt: string
  lines: ValuationLineView[]
}

const valuationSelect = {
  id: true, valuationCode: true, projectId: true, periodMonth: true, revisionNumber: true,
  supersededAt: true, status: true, progressPct: true, cumulativeMeasured: true,
  cumulativeLumpsum: true, grossAmount: true, previousGross: true, retentionHeld: true,
  advanceRecovery: true, netPayable: true, contractValueAtCert: true, retentionPctAtCert: true,
  advancePctAtCert: true, certifiedAt: true, invoicedAt: true, expectedReceipt: true, createdAt: true,
  lines: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, assetId: true, assetName: true, cumulativeMeasured: true, cumulativeLumpsum: true, cumulativeGross: true, sortOrder: true } },
} as const

const day = (d: Date | null) => (d == null ? null : d.toISOString().slice(0, 10))

function toView(
  v: Prisma.ValuationGetPayload<{ select: typeof valuationSelect }>,
  priorLines: Map<string, { measured: number; lumpsum: number; gross: number }>,
  priorRetentionHeld: number,
): ValuationView {
  return {
    id: v.id,
    valuationCode: v.valuationCode,
    projectId: v.projectId,
    periodMonth: v.periodMonth.toISOString().slice(0, 10),
    revisionNumber: v.revisionNumber,
    supersededAt: v.supersededAt == null ? null : v.supersededAt.toISOString(),
    status: v.status,
    progressPct: n(v.progressPct),
    cumulativeMeasured: n(v.cumulativeMeasured),
    cumulativeLumpsum: n(v.cumulativeLumpsum),
    grossAmount: n(v.grossAmount),
    previousGross: n(v.previousGross),
    grossThisPeriod: round(n(v.grossAmount) - n(v.previousGross), MONEY_DP),
    retentionHeld: n(v.retentionHeld),
    retentionThisPeriod: round(n(v.retentionHeld) - priorRetentionHeld, MONEY_DP),
    advanceRecovery: n(v.advanceRecovery),
    netPayable: n(v.netPayable),
    contractValueAtCert: nn(v.contractValueAtCert),
    retentionPctAtCert: nn(v.retentionPctAtCert),
    advancePctAtCert: nn(v.advancePctAtCert),
    certifiedAt: v.certifiedAt == null ? null : v.certifiedAt.toISOString(),
    invoicedAt: day(v.invoicedAt),
    expectedReceipt: day(v.expectedReceipt),
    createdAt: v.createdAt.toISOString(),
    lines: v.lines.map((l) => {
      const prev = priorLines.get(l.assetId) ?? { measured: 0, lumpsum: 0, gross: 0 }
      return {
        id: l.id,
        assetId: l.assetId,
        assetName: l.assetName,
        sortOrder: l.sortOrder,
        cumulativeMeasured: n(l.cumulativeMeasured),
        cumulativeLumpsum: n(l.cumulativeLumpsum),
        cumulativeGross: n(l.cumulativeGross),
        measuredThisPeriod: round(n(l.cumulativeMeasured) - prev.measured, MONEY_DP),
        lumpsumThisPeriod: round(n(l.cumulativeLumpsum) - prev.lumpsum, MONEY_DP),
        grossThisPeriod: round(n(l.cumulativeGross) - prev.gross, MONEY_DP),
      }
    }),
  }
}

/** The latest CERTIFIED revision of the most recent earlier period, with its lines. */
async function loadPreviousCertifiedWithLines(projectId: string, periodMonth: Date) {
  const rows = await prisma.valuation.findMany({
    where: { projectId, periodMonth: { lt: periodMonth }, status: 'CERTIFIED' },
    orderBy: [{ periodMonth: 'desc' }, { revisionNumber: 'desc' }],
    take: 1,
    select: { retentionHeld: true, lines: { select: { assetId: true, cumulativeMeasured: true, cumulativeLumpsum: true, cumulativeGross: true } } },
  })
  const prev = rows[0]
  const map = new Map<string, { measured: number; lumpsum: number; gross: number }>()
  for (const l of prev?.lines ?? []) {
    map.set(l.assetId, { measured: n(l.cumulativeMeasured), lumpsum: n(l.cumulativeLumpsum), gross: n(l.cumulativeGross) })
  }
  return { priorLines: map, priorRetentionHeld: prev ? n(prev.retentionHeld) : 0 }
}

export async function loadValuation(projectId: string, valuationId: string): Promise<ValuationView | null> {
  const v = await prisma.valuation.findFirst({ where: { id: valuationId, projectId }, select: valuationSelect })
  if (!v) return null
  const { priorLines, priorRetentionHeld } = await loadPreviousCertifiedWithLines(projectId, v.periodMonth)
  return toView(v, priorLines, priorRetentionHeld)
}

export interface ValuationSummary {
  id: string
  valuationCode: string
  periodMonth: string
  revisionNumber: number
  revisionCount: number
  status: ValuationStatus
  grossAmount: number
  grossThisPeriod: number
  retentionHeld: number
  netPayable: number
  certifiedAt: string | null
  expectedReceipt: string | null
}

/** One row per month: the LIVE revision, plus how many revisions that month has had. */
export async function listValuations(projectId: string): Promise<ValuationSummary[]> {
  const rows = await prisma.valuation.findMany({
    where: { projectId },
    orderBy: [{ periodMonth: 'desc' }, { revisionNumber: 'desc' }],
    select: {
      id: true, valuationCode: true, periodMonth: true, revisionNumber: true, supersededAt: true,
      status: true, grossAmount: true, previousGross: true, retentionHeld: true, netPayable: true,
      certifiedAt: true, expectedReceipt: true,
    },
  })

  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = r.periodMonth.toISOString().slice(0, 10)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return rows
    .filter((r) => r.supersededAt == null)
    .map((r) => {
      const periodMonth = r.periodMonth.toISOString().slice(0, 10)
      return {
        id: r.id,
        valuationCode: r.valuationCode,
        periodMonth,
        revisionNumber: r.revisionNumber,
        revisionCount: counts.get(periodMonth) ?? 1,
        status: r.status,
        grossAmount: n(r.grossAmount),
        grossThisPeriod: round(n(r.grossAmount) - n(r.previousGross), MONEY_DP),
        retentionHeld: n(r.retentionHeld),
        netPayable: n(r.netPayable),
        certifiedAt: r.certifiedAt == null ? null : r.certifiedAt.toISOString(),
        expectedReceipt: day(r.expectedReceipt),
      }
    })
}

/** Every revision of one month, newest first — the revision-history strip. */
export async function loadRevisionHistory(projectId: string, periodMonth: Date) {
  const rows = await prisma.valuation.findMany({
    where: { projectId, periodMonth },
    orderBy: { revisionNumber: 'desc' },
    select: { id: true, valuationCode: true, revisionNumber: true, status: true, supersededAt: true, certifiedAt: true, grossAmount: true },
  })
  return rows.map((r) => ({
    id: r.id,
    valuationCode: r.valuationCode,
    revisionNumber: r.revisionNumber,
    status: r.status,
    supersededAt: r.supersededAt == null ? null : r.supersededAt.toISOString(),
    certifiedAt: r.certifiedAt == null ? null : r.certifiedAt.toISOString(),
    grossAmount: n(r.grossAmount),
  }))
}

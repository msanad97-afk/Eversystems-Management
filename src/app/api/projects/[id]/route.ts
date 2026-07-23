import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, isProjectStatus, parseDate, toIdArray, parsePercent, parseNonNegativeInt, parseCurrency } from '@/lib/validation'

// Header financial fields whose changes are audited old→new (they set what the client is
// billed and when payment falls due — names alone would be the weakest money audit in the app).
const AUDITED_FINANCIAL_FIELDS = [
  'contractValue', 'budgetCost', 'retentionPct', 'retentionCapPct', 'advancePct', 'paymentTermsDays', 'currency',
  'defectsLiabilityMonths', 'retentionFirstReleasePct', // Phase 8 (practicalCompletionDate audited by name only)
] as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const target = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      members: { select: { userId: true } },
      // Selected so a financial change can be audited old→new (see below).
    },
  })
  if (!target) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if ('location' in body) data.location = isNonEmptyString(body.location) ? body.location.trim() : null
  if (isProjectStatus(body.status)) data.status = body.status
  if ('startDate' in body) data.startDate = parseDate(body.startDate)

  // ─── Phase 6A header financials (cross-checked against the bottom-up build-up) ───
  const money = (v: unknown): number | null | undefined => {
    if (v === null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  for (const field of ['contractValue', 'budgetCost'] as const) {
    if (field in body) {
      const v = money(body[field])
      if (v === undefined) return NextResponse.json({ error: `${field} must be a number of 0 or more.` }, { status: 400 })
      data[field] = v
    }
  }

  // ─── Phase 6E-pre: commercial terms the 6D valuation engine reads (retention, advance,
  //     payment terms, currency). Percentages are null=none / 0–100; terms null / integer ≥ 0.
  for (const field of ['retentionPct', 'retentionCapPct', 'advancePct'] as const) {
    if (field in body) {
      const v = parsePercent(body[field])
      if (v === undefined) return NextResponse.json({ error: `${field} must be null or a number from 0 to 100.` }, { status: 400 })
      data[field] = v
    }
  }
  if ('paymentTermsDays' in body) {
    const v = parseNonNegativeInt(body.paymentTermsDays)
    if (v === undefined) return NextResponse.json({ error: 'paymentTermsDays must be null or a whole number of 0 or more.' }, { status: 400 })
    data.paymentTermsDays = v
  }
  if ('currency' in body) {
    const v = parseCurrency(body.currency)
    if (v === undefined) return NextResponse.json({ error: 'currency must be a 3-letter code (e.g. BHD).' }, { status: 400 })
    data.currency = v
  }

  // ─── Phase 8: retention-release terms (practical completion, defects period, first release %) ───
  if ('practicalCompletionDate' in body) {
    data.practicalCompletionDate = body.practicalCompletionDate == null || body.practicalCompletionDate === '' ? null : parseDate(body.practicalCompletionDate)
    if (data.practicalCompletionDate === null && body.practicalCompletionDate != null && body.practicalCompletionDate !== '') {
      return NextResponse.json({ error: 'practicalCompletionDate must be a valid date or empty.' }, { status: 400 })
    }
  }
  if ('defectsLiabilityMonths' in body) {
    const v = parseNonNegativeInt(body.defectsLiabilityMonths)
    if (v === undefined) return NextResponse.json({ error: 'defectsLiabilityMonths must be null or a whole number of 0 or more.' }, { status: 400 })
    data.defectsLiabilityMonths = v
  }
  if ('retentionFirstReleasePct' in body) {
    const v = parsePercent(body.retentionFirstReleasePct)
    if (v === undefined) return NextResponse.json({ error: 'retentionFirstReleasePct must be null or a number from 0 to 100.' }, { status: 400 })
    data.retentionFirstReleasePct = v
  }

  // ─── Member diff ───
  let toAdd: string[] = []
  let toRemove: string[] = []
  const desiredMembers = toIdArray(body.memberIds)
  if (desiredMembers) {
    const current = target.members.map((m) => m.userId)
    toAdd = desiredMembers.filter((id) => !current.includes(id))
    toRemove = current.filter((id) => !desiredMembers.includes(id))

    if (toAdd.length > 0) {
      const count = await prisma.user.count({ where: { id: { in: toAdd } } })
      if (count !== toAdd.length) {
        return NextResponse.json({ error: 'One or more selected users do not exist.' }, { status: 400 })
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.project.update({ where: { id: target.id }, data })
    }
    if (toRemove.length > 0) {
      await tx.projectMember.deleteMany({
        where: { projectId: target.id, userId: { in: toRemove } },
      })
    }
    if (toAdd.length > 0) {
      await tx.projectMember.createMany({
        data: toAdd.map((userId) => ({ projectId: target.id, userId })),
        skipDuplicates: true,
      })
    }
  })

  const ipAddress = getClientIp(req)

  // Record old→new for every changed financial field (Decimal columns arrive as objects, so
  // normalise to Number for a readable, comparable audit value).
  const num = (v: unknown): number | null => (v == null ? null : Number(v))
  const financialChanges: Record<string, { from: number | string | null; to: number | string | null }> = {}
  for (const field of AUDITED_FINANCIAL_FIELDS) {
    if (field in data) {
      const from = field === 'currency' ? (target[field] ?? null) : num(target[field])
      const to = field === 'currency' ? (data[field] as string) : (data[field] as number | null)
      financialChanges[field] = { from, to }
    }
  }

  writeAuditLog({
    action: 'PROJECT_UPDATED',
    userId: guard.user.id,
    projectId: target.id,
    entity: 'Project',
    entityId: target.id,
    entityCode: target.projectCode,
    metadata: {
      fields: Object.keys(data),
      ...(Object.keys(financialChanges).length > 0 ? { financials: financialChanges } : {}),
    },
    ipAddress,
  })
  for (const userId of toAdd) {
    writeAuditLog({
      action: 'PROJECT_MEMBER_ADDED',
      userId: guard.user.id,
      projectId: target.id,
      entity: 'Project',
      entityId: target.id,
      entityCode: target.projectCode,
      metadata: { memberId: userId },
      ipAddress,
    })
  }
  for (const userId of toRemove) {
    writeAuditLog({
      action: 'PROJECT_MEMBER_REMOVED',
      userId: guard.user.id,
      projectId: target.id,
      entity: 'Project',
      entityId: target.id,
      entityCode: target.projectCode,
      metadata: { memberId: userId },
      ipAddress,
    })
  }

  const updated = await prisma.project.findUnique({
    where: { id: target.id },
    select: {
      id: true,
      projectCode: true,
      name: true,
      location: true,
      status: true,
      startDate: true,
      contractValue: true,
      budgetCost: true,
      retentionPct: true,
      retentionCapPct: true,
      advancePct: true,
      paymentTermsDays: true,
      currency: true,
      practicalCompletionDate: true,
      defectsLiabilityMonths: true,
      retentionFirstReleasePct: true,
    },
  })

  return NextResponse.json({ project: updated })
}

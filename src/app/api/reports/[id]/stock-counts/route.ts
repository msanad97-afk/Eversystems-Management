import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canAuthorReport } from '@/lib/reports/query'
import { canEdit } from '@/lib/reports/rules'
import { isNonEmptyString } from '@/lib/validation'
import { loadProjectBalanceMap } from '@/lib/inventory/balance.server'
import { loadReportStockCount } from '@/lib/inventory/stockCount.server'

interface CountInput {
  notes: string | null
  lines: { materialId: string; countedQuantity: number }[]
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function parseBody(raw: unknown): CountInput | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const notes = isNonEmptyString(b.notes) ? b.notes.trim() : null
  if (!Array.isArray(b.lines)) return null
  const lines: CountInput['lines'] = []
  for (const r of b.lines) {
    if (!r || typeof r !== 'object') return null
    const materialId = isNonEmptyString((r as { materialId?: unknown }).materialId) ? (r as { materialId: string }).materialId : ''
    const countedQuantity = Number((r as { countedQuantity?: unknown }).countedQuantity)
    if (!materialId || !Number.isFinite(countedQuantity) || countedQuantity < 0) return null
    lines.push({ materialId, countedQuantity })
  }
  return { notes, lines }
}

/**
 * Save (replace) the stock count entered on a report. Quantities only — NO cost. Each line snapshots
 * the derived system balance at save time (the ONE balance helper) and stores variance = counted −
 * system. Partial counts are legal; an empty count removes the report's stock count.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, projectId: true, status: true, reportCode: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) return NextResponse.json({ error: 'You can only count stock on your own reports.' }, { status: 403 })
  if (!canEdit(report.status)) return NextResponse.json({ error: 'This report can no longer be edited.' }, { status: 409 })

  const input = parseBody(await req.json().catch(() => null))
  if (!input) return NextResponse.json({ error: 'Invalid stock count.' }, { status: 400 })
  const uniqueIds = new Set(input.lines.map((l) => l.materialId))
  if (uniqueIds.size !== input.lines.length) return NextResponse.json({ error: 'Each material can be counted only once.' }, { status: 400 })

  const materials = await prisma.material.findMany({ where: { id: { in: [...uniqueIds] } }, select: { id: true, unit: true } })
  if (materials.length !== uniqueIds.size) {
    return NextResponse.json({ error: 'One or more materials were not found.' }, { status: 400 })
  }
  const unitById = new Map(materials.map((m) => [m.id, m.unit]))

  // Snapshot the system-expected balance for each counted material at THIS moment.
  const balances = await loadProjectBalanceMap(prisma, report.projectId)

  await prisma.$transaction(async (tx) => {
    await tx.stockCount.deleteMany({ where: { dailyReportId: report.id } }) // replace: cascades old lines
    if (input.lines.length === 0) return
    await tx.stockCount.create({
      data: {
        dailyReportId: report.id,
        projectId: report.projectId,
        countedById: guard.user.id,
        notes: input.notes,
        lines: {
          create: input.lines.map((l) => {
            const system = balances.get(l.materialId)?.onHand ?? 0
            return {
              materialId: l.materialId,
              countedQuantity: l.countedQuantity,
              systemQuantity: round3(system),
              variance: round3(l.countedQuantity - system),
              unit: unitById.get(l.materialId) ?? '',
            }
          }),
        },
      },
      select: { id: true },
    })
  })

  writeAuditLog({
    action: 'STOCK_COUNT_RECORDED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'DailyReport',
    entityId: report.id,
    entityCode: report.reportCode,
    metadata: { lineCount: input.lines.length },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ stockCount: await loadReportStockCount(report.id) })
}

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canAuthorReport } from '@/lib/reports/query'
import { canEdit } from '@/lib/reports/rules'
import { isNonEmptyString } from '@/lib/validation'
import { validateDeliveryInput, type DeliveryInput } from '@/lib/deliveries/types'
import { loadDelivery } from '@/lib/deliveries/deliveries.server'

function parseBody(raw: unknown): DeliveryInput | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const supplierName = isNonEmptyString(b.supplierName) ? b.supplierName.trim() : ''
  const deliveryNoteNumber = isNonEmptyString(b.deliveryNoteNumber) ? b.deliveryNoteNumber.trim() : ''
  const notes = isNonEmptyString(b.notes) ? b.notes.trim() : null
  if (!Array.isArray(b.lines)) return null
  const lines = []
  for (const r of b.lines) {
    if (!r || typeof r !== 'object') return null
    const materialId = isNonEmptyString((r as { materialId?: unknown }).materialId) ? (r as { materialId: string }).materialId : ''
    const quantity = Number((r as { quantity?: unknown }).quantity)
    if (!materialId || !Number.isFinite(quantity)) return null
    lines.push({ materialId, quantity, unit: '' }) // unit snapshotted server-side from the catalog
  }
  return { supplierName, deliveryNoteNumber, notes, lines }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, projectId: true, status: true, reportCode: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) return NextResponse.json({ error: 'You can only add deliveries to your own reports.' }, { status: 403 })
  if (!canEdit(report.status)) return NextResponse.json({ error: 'This report can no longer be edited.' }, { status: 409 })

  const input = parseBody(await req.json().catch(() => null))
  if (!input) return NextResponse.json({ error: 'Invalid delivery.' }, { status: 400 })
  const error = validateDeliveryInput(input)
  if (error) return NextResponse.json({ error }, { status: 400 })

  // Snapshot each line's unit from the catalogue at entry (never a live read later).
  const materials = await prisma.material.findMany({
    where: { id: { in: input.lines.map((l) => l.materialId) } },
    select: { id: true, unit: true },
  })
  const unitById = new Map(materials.map((m) => [m.id, m.unit]))
  if (unitById.size !== new Set(input.lines.map((l) => l.materialId)).size) {
    return NextResponse.json({ error: 'One or more materials were not found.' }, { status: 400 })
  }

  const created = await prisma.$transaction((tx) =>
    tx.delivery.create({
      data: {
        dailyReportId: report.id,
        supplierName: input.supplierName,
        deliveryNoteNumber: input.deliveryNoteNumber,
        notes: input.notes ?? null,
        createdById: guard.user.id,
        lines: { create: input.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, unit: unitById.get(l.materialId)! })) },
      },
      select: { id: true },
    }),
  )

  writeAuditLog({
    action: 'DELIVERY_CREATED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'Delivery',
    entityId: created.id,
    entityCode: report.reportCode,
    metadata: { supplierName: input.supplierName, deliveryNoteNumber: input.deliveryNoteNumber, lineCount: input.lines.length },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ delivery: await loadDelivery(created.id) }, { status: 201 })
}

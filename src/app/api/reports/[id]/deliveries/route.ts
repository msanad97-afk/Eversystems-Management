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
  const supplierId = isNonEmptyString(b.supplierId) ? b.supplierId.trim() : ''
  const deliveryNoteNumber = isNonEmptyString(b.deliveryNoteNumber) ? b.deliveryNoteNumber.trim() : ''
  const notes = isNonEmptyString(b.notes) ? b.notes.trim() : null
  if (!Array.isArray(b.lines)) return null
  const lines = []
  for (const r of b.lines) {
    if (!r || typeof r !== 'object') return null
    const materialId = isNonEmptyString((r as { materialId?: unknown }).materialId) ? (r as { materialId: string }).materialId : ''
    const quantity = Number((r as { quantity?: unknown }).quantity)
    if (!materialId || !Number.isFinite(quantity)) return null
    lines.push({ materialId, quantity })
  }
  return { supplierId, deliveryNoteNumber, notes, lines }
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

  // A delivery note covers exactly one supplier — chosen by id, required, must exist.
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true } })
  if (!supplier) return NextResponse.json({ error: 'Unknown supplier.' }, { status: 400 })

  // Every line's material must belong to the selected supplier. Snapshot the unit at entry.
  const materials = await prisma.material.findMany({
    where: { id: { in: input.lines.map((l) => l.materialId) } },
    select: { id: true, name: true, unit: true, supplierId: true },
  })
  const byId = new Map(materials.map((m) => [m.id, m]))
  if (byId.size !== new Set(input.lines.map((l) => l.materialId)).size) {
    return NextResponse.json({ error: 'One or more materials were not found.' }, { status: 400 })
  }
  for (const l of input.lines) {
    const m = byId.get(l.materialId)!
    if (m.supplierId == null) {
      return NextResponse.json({ error: `"${m.name}" has no supplier assigned. Ask an admin to set its supplier before it can be delivered.` }, { status: 400 })
    }
    if (m.supplierId !== supplier.id) {
      return NextResponse.json({ error: `"${m.name}" does not belong to ${supplier.name}. A delivery note covers one supplier only.` }, { status: 400 })
    }
  }

  const created = await prisma.$transaction((tx) =>
    tx.delivery.create({
      data: {
        dailyReportId: report.id,
        supplierId: supplier.id,
        supplierName: supplier.name, // frozen snapshot of the supplier name at entry
        deliveryNoteNumber: input.deliveryNoteNumber,
        notes: input.notes ?? null,
        createdById: guard.user.id,
        lines: { create: input.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, unit: byId.get(l.materialId)!.unit })) },
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
    metadata: { supplierId: supplier.id, supplierName: supplier.name, deliveryNoteNumber: input.deliveryNoteNumber, lineCount: input.lines.length },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ delivery: await loadDelivery(created.id) }, { status: 201 })
}

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canAuthorReport } from '@/lib/reports/query'
import { canEdit } from '@/lib/reports/rules'

/** Remove a delivery. Author only, and only while the parent report is still editable. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; deliveryId: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const delivery = await prisma.delivery.findUnique({
    where: { id: params.deliveryId },
    select: { id: true, dailyReportId: true, dailyReport: { select: { id: true, authorId: true, projectId: true, status: true, reportCode: true } } },
  })
  if (!delivery || delivery.dailyReportId !== params.id) {
    return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 })
  }
  const report = delivery.dailyReport

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) return NextResponse.json({ error: 'You can only edit your own reports.' }, { status: 403 })
  if (!canEdit(report.status)) return NextResponse.json({ error: 'This report can no longer be edited.' }, { status: 409 })

  await prisma.delivery.delete({ where: { id: delivery.id } }) // cascades lines

  writeAuditLog({
    action: 'DELIVERY_DELETED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'Delivery',
    entityId: delivery.id,
    entityCode: report.reportCode,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}

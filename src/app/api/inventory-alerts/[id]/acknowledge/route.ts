import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

/** Acknowledge an OPEN inventory alert. ADMIN ONLY. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const alert = await prisma.inventoryAlert.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, projectId: true, type: true },
  })
  if (!alert) return NextResponse.json({ error: 'Alert not found.' }, { status: 404 })
  if (alert.status !== 'OPEN') return NextResponse.json({ error: 'Alert is already acknowledged.' }, { status: 409 })

  await prisma.inventoryAlert.update({
    where: { id: alert.id },
    data: { status: 'ACKNOWLEDGED', acknowledgedById: guard.user.id, acknowledgedAt: new Date() },
  })

  writeAuditLog({
    action: 'INVENTORY_ALERT_ACKNOWLEDGED',
    userId: guard.user.id,
    projectId: alert.projectId,
    entity: 'InventoryAlert',
    entityId: alert.id,
    metadata: { type: alert.type },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}

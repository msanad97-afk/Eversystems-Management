import { NextResponse, type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { repriceActivity } from '@/lib/money.server'

/**
 * Re-snapshot current global cost rates onto this activity's frozen budget rows.
 * Allowed even when approved reports exist — it shifts the budget baseline (and therefore
 * variance/CPI), so the UI warns first and every old→new rate change is audited.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const activity = await prisma.activity.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, asset: { select: { projectId: true } } },
  })
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })

  const changes = await prisma.$transaction((tx) => repriceActivity(tx, activity.id))

  writeAuditLog({
    action: 'ACTIVITY_REPRICED',
    userId: guard.user.id,
    projectId: activity.asset.projectId,
    entity: 'Activity',
    entityId: activity.id,
    metadata: { name: activity.name, changeCount: changes.length, changes } as unknown as Prisma.InputJsonValue,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, changes })
}

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

/**
 * Deactivate / reactivate (PATCH) or remove (DELETE) ONE named sub-activity on a placed activity.
 * ADMIN only. BAC and physical % are derived at read time, so a deactivated sub drops out of both
 * on the next load; approved reports and certified valuations are frozen and never move.
 *
 * Guards (both verbs): the sub must belong to the activity in the path (404); the implicit sub is
 * off-limits — it carries a flat activity's whole budget (409); and an activity must always keep at
 * least one active sub, so the LAST active one cannot be deactivated/deleted (409).
 */
type Params = { params: { id: string; subId: string } }

async function loadSub(activityId: string, subId: string) {
  const sub = await prisma.subActivity.findUnique({
    where: { id: subId },
    select: {
      id: true, name: true, type: true, isActive: true, isImplicit: true, activityId: true,
      activity: { select: { name: true, asset: { select: { projectId: true } } } },
      _count: { select: { progress: true } },
    },
  })
  if (!sub || sub.activityId !== activityId) return null
  return sub
}

const auditBase = (userId: string, sub: NonNullable<Awaited<ReturnType<typeof loadSub>>>) => ({
  userId,
  projectId: sub.activity.asset.projectId,
  entity: 'SubActivity' as const,
  entityId: sub.id,
})

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const sub = await loadSub(params.id, params.subId)
  if (!sub) return NextResponse.json({ error: 'Sub-activity not found on this activity.' }, { status: 404 })
  if (sub.isImplicit) return NextResponse.json({ error: 'The implicit sub-activity cannot be changed — it carries the activity’s whole budget.' }, { status: 409 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.isActive !== 'boolean') return NextResponse.json({ error: 'isActive (boolean) is required.' }, { status: 400 })

  // Deactivating the last active sub would leave the activity unreportable.
  if (body.isActive === false && sub.isActive) {
    const activeCount = await prisma.subActivity.count({ where: { activityId: params.id, isActive: true } })
    if (activeCount <= 1) return NextResponse.json({ error: 'An activity must keep at least one active sub-activity.' }, { status: 409 })
  }

  await prisma.$transaction((tx) => tx.subActivity.update({ where: { id: sub.id }, data: { isActive: body.isActive } }))

  writeAuditLog({
    action: 'SUBACTIVITY_UPDATED',
    ...auditBase(guard.user.id, sub),
    metadata: { activityId: params.id, activityName: sub.activity.name, subActivityName: sub.name, isActive: body.isActive },
    ipAddress: getClientIp(req),
  })
  return NextResponse.json({ ok: true, id: sub.id, isActive: body.isActive })
}

/**
 * Remove a sub-activity. Same safe rule as the activity DELETE: if it has ever been reported
 * against it is DEACTIVATED (never deleted), so no approved report loses the line it was written
 * against; only an unreferenced sub is hard-deleted. The response says which happened.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const sub = await loadSub(params.id, params.subId)
  if (!sub) return NextResponse.json({ error: 'Sub-activity not found on this activity.' }, { status: 404 })
  if (sub.isImplicit) return NextResponse.json({ error: 'The implicit sub-activity cannot be removed — it carries the activity’s whole budget.' }, { status: 409 })

  // Removing the last active sub (hard-delete OR deactivate) would leave the activity unreportable.
  if (sub.isActive) {
    const activeCount = await prisma.subActivity.count({ where: { activityId: params.id, isActive: true } })
    if (activeCount <= 1) return NextResponse.json({ error: 'An activity must keep at least one active sub-activity.' }, { status: 409 })
  }

  const reported = sub._count.progress
  if (reported === 0) {
    await prisma.$transaction((tx) => tx.subActivity.delete({ where: { id: sub.id } }))
    writeAuditLog({
      action: 'SUBACTIVITY_DELETED',
      ...auditBase(guard.user.id, sub),
      metadata: { op: 'delete', activityId: params.id, activityName: sub.activity.name, subActivityName: sub.name },
      ipAddress: getClientIp(req),
    })
    return NextResponse.json({ ok: true, deleted: true, id: sub.id })
  }

  await prisma.$transaction((tx) => tx.subActivity.update({ where: { id: sub.id }, data: { isActive: false } }))
  const references = { reportedSubActivities: reported }
  writeAuditLog({
    action: 'SUBACTIVITY_UPDATED',
    ...auditBase(guard.user.id, sub),
    metadata: { op: 'deactivate', reason: 'in_use', activityId: params.id, activityName: sub.activity.name, subActivityName: sub.name, references },
    ipAddress: getClientIp(req),
  })
  return NextResponse.json({ ok: true, deactivated: true, id: sub.id, references })
}

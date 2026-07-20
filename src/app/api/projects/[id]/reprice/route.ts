import { NextResponse, type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { repriceActivity, type RateChange } from '@/lib/money.server'

/** Project-wide re-price: applies repriceActivity to every active activity (see that helper). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const activities = await prisma.activity.findMany({
    where: { isActive: true, asset: { projectId: project.id, isActive: true } },
    select: { id: true, name: true },
  })

  const all: (RateChange & { activityName: string })[] = []
  await prisma.$transaction(async (tx) => {
    for (const a of activities) {
      const changes = await repriceActivity(tx, a.id)
      all.push(...changes.map((c) => ({ ...c, activityName: a.name })))
    }
  })

  writeAuditLog({
    action: 'ACTIVITY_REPRICED',
    userId: guard.user.id,
    projectId: project.id,
    entity: 'Project',
    entityId: project.id,
    entityCode: project.projectCode,
    metadata: { op: 'project_reprice', activityCount: activities.length, changeCount: all.length, changes: all } as unknown as Prisma.InputJsonValue,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, activityCount: activities.length, changes: all })
}

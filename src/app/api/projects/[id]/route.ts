import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, isProjectStatus, parseDate, toIdArray } from '@/lib/validation'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const target = await prisma.project.findUnique({
    where: { id: params.id },
    include: { members: { select: { userId: true } } },
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
  writeAuditLog({
    action: 'PROJECT_UPDATED',
    userId: guard.user.id,
    projectId: target.id,
    entity: 'Project',
    entityId: target.id,
    entityCode: target.projectCode,
    metadata: { fields: Object.keys(data) },
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
    },
  })

  return NextResponse.json({ project: updated })
}

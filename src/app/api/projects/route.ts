import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { nextCode } from '@/lib/idgen'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, isProjectStatus, parseDate, toIdArray } from '@/lib/validation'
import { todayCivilString } from '@/lib/datetime'

export async function GET() {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const projects = await prisma.project.findMany({
    orderBy: { projectCode: 'asc' },
    select: {
      id: true,
      projectCode: true,
      name: true,
      location: true,
      status: true,
      startDate: true,
      createdAt: true,
      members: {
        select: {
          user: { select: { id: true, userCode: true, firstName: true, lastName: true, role: true } },
        },
      },
    },
  })

  return NextResponse.json({
    projects: projects.map((p) => ({
      ...p,
      members: p.members.map((m) => m.user),
    })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const name = isNonEmptyString(body.name) ? body.name.trim() : null
  const location = isNonEmptyString(body.location) ? body.location.trim() : null
  const status = isProjectStatus(body.status) ? body.status : 'ACTIVE'
  const startDate = parseDate(body.startDate)
  const memberIds = toIdArray(body.memberIds) ?? []

  if (!name) {
    return NextResponse.json({ error: 'Project name is required.' }, { status: 400 })
  }

  if (memberIds.length > 0) {
    const count = await prisma.user.count({ where: { id: { in: memberIds } } })
    if (count !== memberIds.length) {
      return NextResponse.json({ error: 'One or more selected users do not exist.' }, { status: 400 })
    }
  }

  const year = Number(todayCivilString().slice(0, 4))
  const created = await prisma.$transaction(async (tx) => {
    const projectCode = await nextCode(tx, `project:${year}`, `PRJ-${year}`, 3)
    return tx.project.create({
      data: {
        projectCode,
        name,
        location,
        status,
        startDate,
        createdBy: guard.user.id,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      select: { id: true, projectCode: true, name: true },
    })
  })

  const ipAddress = getClientIp(req)
  writeAuditLog({
    action: 'PROJECT_CREATED',
    userId: guard.user.id,
    projectId: created.id,
    entity: 'Project',
    entityId: created.id,
    entityCode: created.projectCode,
    metadata: { name: created.name, memberCount: memberIds.length },
    ipAddress,
  })
  for (const userId of memberIds) {
    writeAuditLog({
      action: 'PROJECT_MEMBER_ADDED',
      userId: guard.user.id,
      projectId: created.id,
      entity: 'Project',
      entityId: created.id,
      entityCode: created.projectCode,
      metadata: { memberId: userId },
      ipAddress,
    })
  }

  return NextResponse.json({ project: created }, { status: 201 })
}

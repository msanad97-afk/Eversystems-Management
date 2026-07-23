import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { nextCode } from '@/lib/idgen'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, isProjectStatus, parseDate, toIdArray, parsePercent, parseNonNegativeInt, parseCurrency } from '@/lib/validation'
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
      contractValue: true,
      budgetCost: true,
      retentionPct: true,
      retentionCapPct: true,
      advancePct: true,
      paymentTermsDays: true,
      currency: true,
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

  // ─── Phase 6E-pre: header financials, settable at creation. Same rules as the PATCH.
  //     Absent → column default (currency BHD, paymentTermsDays 45); present-but-invalid → 400.
  const financials: Record<string, number | string | null> = {}
  const money = (v: unknown): number | null | undefined => {
    if (v === null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  for (const field of ['contractValue', 'budgetCost'] as const) {
    if (field in body) {
      const v = money(body[field])
      if (v === undefined) return NextResponse.json({ error: `${field} must be a number of 0 or more.` }, { status: 400 })
      financials[field] = v
    }
  }
  for (const field of ['retentionPct', 'retentionCapPct', 'advancePct'] as const) {
    if (field in body) {
      const v = parsePercent(body[field])
      if (v === undefined) return NextResponse.json({ error: `${field} must be null or a number from 0 to 100.` }, { status: 400 })
      financials[field] = v
    }
  }
  if ('paymentTermsDays' in body) {
    const v = parseNonNegativeInt(body.paymentTermsDays)
    if (v === undefined) return NextResponse.json({ error: 'paymentTermsDays must be null or a whole number of 0 or more.' }, { status: 400 })
    financials.paymentTermsDays = v
  }
  if ('currency' in body) {
    const v = parseCurrency(body.currency)
    if (v === undefined) return NextResponse.json({ error: 'currency must be a 3-letter code (e.g. BHD).' }, { status: 400 })
    financials.currency = v
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
        ...financials,
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
    metadata: { name: created.name, memberCount: memberIds.length, ...(Object.keys(financials).length > 0 ? { financials } : {}) },
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

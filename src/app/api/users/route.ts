import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { nextCode } from '@/lib/idgen'
import { hashPassword, validatePassword, generateTempPassword } from '@/lib/auth/password'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isEmail, isNonEmptyString, isRole, normalizeEmail, toIdArray } from '@/lib/validation'

export async function GET() {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const users = await prisma.user.findMany({
    orderBy: { userCode: 'asc' },
    select: {
      id: true,
      userCode: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      projects: {
        select: { project: { select: { id: true, projectCode: true, name: true } } },
      },
    },
  })

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      projects: u.projects.map((p) => p.project),
    })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const firstName = isNonEmptyString(body.firstName) ? body.firstName.trim() : null
  const lastName = isNonEmptyString(body.lastName) ? body.lastName.trim() : null
  const email = isEmail(body.email) ? normalizeEmail(body.email) : null
  const phone = isNonEmptyString(body.phone) ? body.phone.trim() : null
  const role = isRole(body.role) ? body.role : null
  const projectIds = toIdArray(body.projectIds) ?? []

  if (!firstName || !lastName || !email || !role) {
    return NextResponse.json(
      { error: 'First name, last name, a valid email, and role are required.' },
      { status: 400 },
    )
  }

  // Temp password: admin-provided or auto-generated. User must change it on first login.
  const tempPassword = isNonEmptyString(body.tempPassword) ? body.tempPassword : generateTempPassword()
  const passwordError = validatePassword(tempPassword)
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 })
  }

  // Validate all project ids exist before assigning.
  if (projectIds.length > 0) {
    const count = await prisma.project.count({ where: { id: { in: projectIds } } })
    if (count !== projectIds.length) {
      return NextResponse.json({ error: 'One or more selected projects do not exist.' }, { status: 400 })
    }
  }

  const passwordHash = await hashPassword(tempPassword)

  const created = await prisma.$transaction(async (tx) => {
    const userCode = await nextCode(tx, 'user', 'USR', 5)
    const user = await tx.user.create({
      data: {
        userCode,
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        role,
        status: 'ACTIVE',
        mustChangePassword: true,
        projects: {
          create: projectIds.map((projectId) => ({ projectId })),
        },
      },
      select: { id: true, userCode: true, email: true, firstName: true, lastName: true, role: true },
    })
    return user
  })

  const ipAddress = getClientIp(req)
  writeAuditLog({
    action: 'USER_CREATED',
    userId: guard.user.id,
    entity: 'User',
    entityId: created.id,
    entityCode: created.userCode,
    metadata: { email: created.email, role: created.role, projectCount: projectIds.length },
    ipAddress,
  })
  for (const projectId of projectIds) {
    writeAuditLog({
      action: 'PROJECT_MEMBER_ADDED',
      userId: guard.user.id,
      projectId,
      entity: 'User',
      entityId: created.id,
      entityCode: created.userCode,
      ipAddress,
    })
  }

  // Return the temp password ONCE so the admin can hand it to the new user.
  return NextResponse.json({ user: created, tempPassword }, { status: 201 })
}

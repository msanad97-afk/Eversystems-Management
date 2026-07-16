import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { hashPassword, validatePassword, generateTempPassword } from '@/lib/auth/password'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import type { UserStatus } from '@prisma/client'
import { isNonEmptyString, isRole, isUserStatus, toIdArray } from '@/lib/validation'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    include: { projects: { select: { projectId: true } } },
  })
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  const isSelf = target.id === guard.user.id
  const ipAddress = getClientIp(req)

  // ─── Build profile/role update ───
  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.firstName)) data.firstName = body.firstName.trim()
  if (isNonEmptyString(body.lastName)) data.lastName = body.lastName.trim()
  if ('phone' in body) data.phone = isNonEmptyString(body.phone) ? body.phone.trim() : null

  if (isRole(body.role) && body.role !== target.role) {
    if (isSelf) {
      return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 })
    }
    data.role = body.role
  }

  // ─── Status change ───
  let newStatus: UserStatus | null = null
  if (isUserStatus(body.status) && body.status !== target.status) {
    if (isSelf && body.status === 'INACTIVE') {
      return NextResponse.json(
        { error: 'You cannot deactivate your own account.' },
        { status: 400 },
      )
    }
    data.status = body.status
    newStatus = body.status
  }

  // ─── Admin password reset ───
  let newTempPassword: string | null = null
  if (body.resetPassword === true) {
    const candidate: string = isNonEmptyString(body.tempPassword)
      ? body.tempPassword
      : generateTempPassword()
    const passwordError = validatePassword(candidate)
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
    newTempPassword = candidate
    data.passwordHash = await hashPassword(candidate)
    data.mustChangePassword = true
    data.resetToken = null
    data.resetTokenExpiry = null
  }

  // ─── Project membership diff ───
  let toAdd: string[] = []
  let toRemove: string[] = []
  const desiredProjects = toIdArray(body.projectIds)
  if (desiredProjects) {
    const current = target.projects.map((p) => p.projectId)
    toAdd = desiredProjects.filter((id) => !current.includes(id))
    toRemove = current.filter((id) => !desiredProjects.includes(id))

    if (toAdd.length > 0) {
      const count = await prisma.project.count({ where: { id: { in: toAdd } } })
      if (count !== toAdd.length) {
        return NextResponse.json({ error: 'One or more selected projects do not exist.' }, { status: 400 })
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.user.update({ where: { id: target.id }, data })
    }
    if (toRemove.length > 0) {
      await tx.projectMember.deleteMany({
        where: { userId: target.id, projectId: { in: toRemove } },
      })
    }
    if (toAdd.length > 0) {
      await tx.projectMember.createMany({
        data: toAdd.map((projectId) => ({ userId: target.id, projectId })),
        skipDuplicates: true,
      })
    }
  })

  // ─── Audit ───
  writeAuditLog({
    action: 'USER_UPDATED',
    userId: guard.user.id,
    entity: 'User',
    entityId: target.id,
    entityCode: target.userCode,
    metadata: {
      fields: Object.keys(data).filter((k) => k !== 'passwordHash'),
      passwordReset: newTempPassword !== null,
    },
    ipAddress,
  })
  if (newStatus) {
    writeAuditLog({
      action: 'USER_STATUS_CHANGED',
      userId: guard.user.id,
      entity: 'User',
      entityId: target.id,
      entityCode: target.userCode,
      metadata: { status: newStatus },
      ipAddress,
    })
  }
  for (const projectId of toAdd) {
    writeAuditLog({
      action: 'PROJECT_MEMBER_ADDED',
      userId: guard.user.id,
      projectId,
      entity: 'User',
      entityId: target.id,
      entityCode: target.userCode,
      ipAddress,
    })
  }
  for (const projectId of toRemove) {
    writeAuditLog({
      action: 'PROJECT_MEMBER_REMOVED',
      userId: guard.user.id,
      projectId,
      entity: 'User',
      entityId: target.id,
      entityCode: target.userCode,
      ipAddress,
    })
  }

  const updated = await prisma.user.findUnique({
    where: { id: target.id },
    select: {
      id: true,
      userCode: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      role: true,
      status: true,
    },
  })

  return NextResponse.json({ user: updated, tempPassword: newTempPassword })
}

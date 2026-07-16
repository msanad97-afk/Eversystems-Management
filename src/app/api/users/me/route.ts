import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

export async function GET() {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const user = await prisma.user.findUnique({
    where: { id: guard.user.id },
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
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  return NextResponse.json({ user })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  // Self-service edits are limited to name and phone. Email/role/status are admin-only.
  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.firstName)) data.firstName = body.firstName.trim()
  if (isNonEmptyString(body.lastName)) data.lastName = body.lastName.trim()
  if ('phone' in body) data.phone = isNonEmptyString(body.phone) ? body.phone.trim() : null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const updated = await prisma.user.update({
    where: { id: guard.user.id },
    data,
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

  writeAuditLog({
    action: 'USER_UPDATED',
    userId: guard.user.id,
    entity: 'User',
    entityId: guard.user.id,
    entityCode: updated.userCode,
    metadata: { fields: Object.keys(data), self: true },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ user: updated })
}

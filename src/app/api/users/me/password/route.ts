import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { hashPassword, verifyPassword, validatePassword } from '@/lib/auth/password'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

export async function PATCH(req: NextRequest) {
  // A user with mustChangePassword MUST be able to reach this route to clear the flag.
  const guard = await requireUser({ allowPasswordChange: true })
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const currentPassword = isNonEmptyString(body?.currentPassword) ? body.currentPassword : ''
  const newPassword = isNonEmptyString(body?.newPassword) ? body.newPassword : ''

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: 'Current and new passwords are required.' },
      { status: 400 },
    )
  }

  const passwordError = validatePassword(newPassword)
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: guard.user.id } })
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  const ok = await verifyPassword(currentPassword, user.passwordHash)
  if (!ok) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
  }

  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false, resetToken: null, resetTokenExpiry: null },
  })

  writeAuditLog({
    action: 'PASSWORD_RESET_COMPLETED',
    userId: user.id,
    entity: 'User',
    entityId: user.id,
    entityCode: user.userCode,
    metadata: { self: true },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}

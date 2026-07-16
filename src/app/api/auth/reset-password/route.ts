import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, validatePassword } from '@/lib/auth/password'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''

  if (!token) {
    return NextResponse.json({ error: 'Invalid or expired reset link.' }, { status: 400 })
  }

  const passwordError = validatePassword(newPassword)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { resetToken: token } })
  if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired reset link.' }, { status: 400 })
  }

  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetToken: null,
      resetTokenExpiry: null,
      mustChangePassword: false,
    },
  })

  writeAuditLog({
    action: 'PASSWORD_RESET_COMPLETED',
    userId: user.id,
    entity: 'User',
    entityId: user.id,
    entityCode: user.userCode,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}

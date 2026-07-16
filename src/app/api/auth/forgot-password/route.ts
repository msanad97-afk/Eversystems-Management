import { randomBytes } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { sendPasswordResetEmail } from '@/lib/email'
import { getClientIp } from '@/lib/request'

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  // Neutral response regardless of outcome — never reveal whether the account exists.
  const neutral = NextResponse.json({ ok: true })
  if (!email) return neutral

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || user.status !== 'ACTIVE') return neutral

  const token = randomBytes(32).toString('hex')
  const resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MS)

  await prisma.user.update({
    where: { id: user.id },
    data: { resetToken: token, resetTokenExpiry },
  })

  writeAuditLog({
    action: 'PASSWORD_RESET_REQUESTED',
    userId: user.id,
    entity: 'User',
    entityId: user.id,
    entityCode: user.userCode,
    ipAddress: getClientIp(req),
  })

  try {
    await sendPasswordResetEmail({ to: user.email, firstName: user.firstName, token })
  } catch (err) {
    console.error('[forgot-password] failed to send email', err)
  }

  return neutral
}

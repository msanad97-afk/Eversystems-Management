/**
 * One-off, idempotent first-admin bootstrap (§1.5 of the deployment guide).
 *
 * Production has no self-signup, so a fresh database has no way in. This creates a single
 * ADMIN with mustChangePassword=true. Re-running with the same email is a no-op.
 *
 * Reuses the existing hashPassword + nextCode helpers — never reimplements them.
 * Credentials come from argv or env, never hardcoded.
 *
 * Run against the UNPOOLED connection (DIRECT_URL), e.g.:
 *   tsx scripts/createAdmin.ts admin@eversystems.net 'Str0ngPass'
 *   ADMIN_EMAIL=admin@eversystems.net ADMIN_PASSWORD='Str0ngPass' tsx scripts/createAdmin.ts
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword, validatePassword } from '../src/lib/auth/password'
import { nextCode } from '../src/lib/idgen'

// Prefer the unpooled direct connection for a one-off admin script; fall back to
// DATABASE_URL for local use where only that is set.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

async function main() {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.argv[3] ?? process.env.ADMIN_PASSWORD ?? ''
  const firstName = (process.env.ADMIN_FIRST_NAME ?? 'System').trim()
  const lastName = (process.env.ADMIN_LAST_NAME ?? 'Administrator').trim()

  if (!email || !password) {
    throw new Error(
      'Usage: tsx scripts/createAdmin.ts <email> <password>  ' +
        '(or set ADMIN_EMAIL / ADMIN_PASSWORD). Credentials are never hardcoded.',
    )
  }

  const passwordError = validatePassword(password)
  if (passwordError) {
    throw new Error(`Admin password rejected: ${passwordError}`)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.info(`Admin ${email} already exists (${existing.userCode}) — no-op.`)
    return
  }

  const passwordHash = await hashPassword(password)
  const userCode = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, 'user', 'USR', 5)
    await tx.user.create({
      data: {
        userCode: code,
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    })
    return code
  })

  console.info(`Created admin ${email} (${userCode}) — must change password on first login.`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err)
    await prisma.$disconnect()
    process.exit(1)
  })

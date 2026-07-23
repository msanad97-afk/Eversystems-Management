/**
 * Boot-time environment validation (§1.4 of the deployment guide).
 *
 * A missing production env var otherwise surfaces as a confusing runtime error far
 * from its cause (a Prisma "query engine" error, a NextAuth callback failure, an email
 * that silently never sends). This fails loudly at server startup instead, naming every
 * missing variable at once.
 *
 * Deliberately dependency-free — a plain presence check, no validation library.
 *
 * Enforced only in production: local dev and CI keep working with the sensible fallbacks
 * baked into email.ts / prisma.ts, and DIRECT_URL is a deploy-time (migration) concern
 * that a developer need not set just to run `next dev`.
 */

const REQUIRED_ENV = [
  'DATABASE_URL', // pooled runtime connection (Neon pooler)
  'DIRECT_URL', // unpooled connection for migrations
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  // Brevo SMTP — password resets & notifications depend on these
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
] as const

export function validateEnv(): void {
  if (process.env.NODE_ENV !== 'production') return

  const missing = REQUIRED_ENV.filter((name) => {
    const value = process.env[name]
    return value === undefined || value.trim() === ''
  })

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them in the Vercel project (Production + Preview) before deploying.',
    )
  }
}

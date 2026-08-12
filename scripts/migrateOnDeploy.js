/*
 * Applies pending Prisma migrations during the Vercel BUILD — but ONLY for the production
 * environment. This runs inside `npm run build` (see package.json).
 *
 * Why the gate is mandatory: DATABASE_URL and DIRECT_URL are scoped to Production AND Preview
 * in Vercel, so a PREVIEW build resolves to the PRODUCTION database. Without this gate, any
 * preview branch's build would run `prisma migrate deploy` against production. So we only
 * migrate when VERCEL_ENV === 'production'.
 *
 * - Non-production (preview) and local builds (VERCEL_ENV unset): log a skip line and exit 0.
 *   Local development applies migrations with `prisma migrate dev`, never this script.
 * - Production: run `prisma migrate deploy` (forward-only; applies only pending migrations).
 *   Migrations route through the unpooled DIRECT_URL automatically (schema `directUrl`).
 * - On failure: exit non-zero so the build fails and Vercel keeps serving the previous
 *   deployment rather than shipping code against an un-migrated database.
 */

const { execSync } = require('child_process')

const env = process.env.VERCEL_ENV

if (env !== 'production') {
  console.log(
    `[migrateOnDeploy] VERCEL_ENV=${env ?? '(unset)'} — not production; skipping "prisma migrate deploy".`,
  )
  process.exit(0)
}

console.log('[migrateOnDeploy] VERCEL_ENV=production — applying migrations with "prisma migrate deploy"…')

try {
  execSync('prisma migrate deploy', { stdio: 'inherit' })
  console.log('[migrateOnDeploy] Migrations applied successfully.')
} catch (err) {
  console.error(
    '[migrateOnDeploy] "prisma migrate deploy" FAILED — failing the build so Vercel keeps the previous deployment.',
  )
  process.exit(1)
}

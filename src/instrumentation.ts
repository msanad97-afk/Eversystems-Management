/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * Requires experimental.instrumentationHook in next.config.js on Next 14.2.
 *
 * Used only to validate environment variables at boot (§1.4). Guarded to the Node.js
 * runtime because the Edge runtime neither runs the DB/SMTP code paths nor exposes
 * these variables.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/env')
    validateEnv()
  }
}

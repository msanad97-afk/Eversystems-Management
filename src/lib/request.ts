import type { NextRequest } from 'next/server'

/** Best-effort client IP for audit logging. */
export function getClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')
}

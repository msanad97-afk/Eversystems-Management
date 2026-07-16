import { NextResponse } from 'next/server'
import { withAuth } from 'next-auth/middleware'

/**
 * Route protection (spec 4.10 + Phase 1 checklist):
 *   - Unauthenticated users hitting a protected page are redirected to /login.
 *   - /admin/* is ADMIN-only; other roles are redirected home.
 *   - A user flagged mustChangePassword is confined to /profile until they change it.
 *
 * API routes are NOT matched here — each API handler enforces its own auth so it can
 * return proper 401/403 JSON instead of an HTML redirect.
 */
export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth
    const { pathname } = req.nextUrl

    if (token?.mustChangePassword && !pathname.startsWith('/profile')) {
      return NextResponse.redirect(new URL('/profile', req.url))
    }

    if (pathname.startsWith('/admin')) {
      // The reports register is readable by ADMIN and VIEWER; the rest of /admin is
      // ADMIN-only. (API routes enforce their own role checks regardless.)
      const viewerAllowed = token?.role === 'VIEWER' && pathname.startsWith('/admin/reports')
      if (token?.role !== 'ADMIN' && !viewerAllowed) {
        return NextResponse.redirect(new URL('/', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: { signIn: '/login' },
  },
)

export const config = {
  matcher: [
    // Everything except API routes, Next internals, and the public auth pages.
    '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|login|forgot-password|reset-password).*)',
  ],
}

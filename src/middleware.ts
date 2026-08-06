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
    // Everything except API routes, Next internals, the public auth pages, and
    // static assets.
    //
    // Assets must stay outside the matcher: `authorized` fails without a token,
    // so a gated asset URL answers with a 307 to /login and an HTML body. The
    // login page is by definition viewed logged out, so gating the brand assets
    // made every <img> on it render its alt text instead of the logo. Matching
    // by extension covers everything served from public/ (logos, marks) plus
    // Next's generated /icon.png and /apple-icon.png.
    '/((?!api|_next/static|_next/image|robots.txt|manifest.webmanifest|login|forgot-password|reset-password|.*\\.(?:png|ico|svg|jpe?g|webp|gif|avif)$).*)',
  ],
}

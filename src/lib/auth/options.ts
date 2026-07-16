import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/auth/password'
import { writeAuditLog, recordAuditLog } from '@/lib/audit'
import { checkLoginRateLimit, acquireLoginLock, releaseLoginLock, loginDelay } from '@/lib/rateLimit'

/**
 * Sign-in error codes thrown by `authorize`. The login page maps these to
 * user-facing messages. Wrong email/password is deliberately indistinguishable
 * (no account enumeration).
 */
export const SIGN_IN_ERROR = {
  INVALID: 'INVALID_CREDENTIALS',
  INACTIVE: 'ACCOUNT_INACTIVE',
  RATE_LIMITED: 'TOO_MANY_ATTEMPTS',
} as const

function ipFromHeaders(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null
  const fwd = headers['x-forwarded-for']
  if (fwd) return fwd.split(',')[0]!.trim()
  return headers['x-real-ip'] ?? null
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password
        const ipAddress = ipFromHeaders(req?.headers as Record<string, string> | undefined)

        if (!email || !password) {
          throw new Error(SIGN_IN_ERROR.INVALID)
        }

        // Reject a second concurrent attempt for the same account while one is in
        // flight — closes the count-then-check race under a burst (see rateLimit.ts).
        if (!acquireLoginLock(email)) {
          throw new Error(SIGN_IN_ERROR.RATE_LIMITED)
        }

        try {
          const user = await prisma.user.findUnique({ where: { email } })

          // Rate limit BEFORE verifying the password, so a locked account/IP is blocked
          // even with correct credentials. A blocked attempt is not itself recorded as a
          // failure, so the window ages out.
          const limit = await checkLoginRateLimit(prisma, { userId: user?.id, ipAddress })
          if (limit.blocked) {
            throw new Error(SIGN_IN_ERROR.RATE_LIMITED)
          }

          // Sign-in guard sequence: existence → password → status.
          if (!user) {
            await recordAuditLog({
              action: 'USER_LOGIN_FAILED',
              entity: 'User',
              metadata: { email, reason: 'no_such_user' },
              ipAddress,
            })
            await loginDelay()
            throw new Error(SIGN_IN_ERROR.INVALID)
          }

          const passwordOk = await verifyPassword(password, user.passwordHash)
          if (!passwordOk) {
            await recordAuditLog({
              action: 'USER_LOGIN_FAILED',
              userId: user.id,
              entity: 'User',
              entityId: user.id,
              entityCode: user.userCode,
              metadata: { reason: 'bad_password' },
              ipAddress,
            })
            await loginDelay()
            throw new Error(SIGN_IN_ERROR.INVALID)
          }

          if (user.status !== 'ACTIVE') {
            await recordAuditLog({
              action: 'USER_LOGIN_FAILED',
              userId: user.id,
              entity: 'User',
              entityId: user.id,
              entityCode: user.userCode,
              metadata: { reason: 'inactive' },
              ipAddress,
            })
            throw new Error(SIGN_IN_ERROR.INACTIVE)
          }

          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
          writeAuditLog({
            action: 'USER_LOGIN',
            userId: user.id,
            entity: 'User',
            entityId: user.id,
            entityCode: user.userCode,
            ipAddress,
          })

          return {
            id: user.id,
            email: user.email,
            userCode: user.userCode,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            status: user.status,
            mustChangePassword: user.mustChangePassword,
          }
        } finally {
          releaseLoginLock(email)
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.userCode = user.userCode
        token.firstName = user.firstName
        token.lastName = user.lastName
        token.role = user.role
        token.status = user.status
        token.mustChangePassword = user.mustChangePassword
      }
      // Allow the app to refresh the flag after a forced password change without re-login.
      if (trigger === 'update' && session?.mustChangePassword === false) {
        token.mustChangePassword = false
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.userCode = token.userCode
        session.user.firstName = token.firstName
        session.user.lastName = token.lastName
        session.user.role = token.role
        session.user.status = token.status
        session.user.mustChangePassword = token.mustChangePassword
      }
      return session
    },
  },
}

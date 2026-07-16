import type { Role, UserStatus } from '@prisma/client'
import type { DefaultSession } from 'next-auth'

/** The authenticated user shape carried in the session and JWT. */
export interface SessionUser {
  id: string
  email: string
  userCode: string
  firstName: string
  lastName: string
  role: Role
  status: UserStatus
  mustChangePassword: boolean
}

declare module 'next-auth' {
  interface Session {
    user: SessionUser & DefaultSession['user']
  }

  interface User {
    id: string
    email: string
    userCode: string
    firstName: string
    lastName: string
    role: Role
    status: UserStatus
    mustChangePassword: boolean
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    userCode: string
    firstName: string
    lastName: string
    role: Role
    status: UserStatus
    mustChangePassword: boolean
  }
}

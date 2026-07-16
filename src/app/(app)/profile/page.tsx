import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { ProfileClient } from './ProfileClient'

export default async function ProfilePage() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      userCode: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      mustChangePassword: true,
    },
  })
  if (!user) redirect('/login')

  return (
    <ProfileClient
      user={{
        userCode: user.userCode,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone ?? '',
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      }}
    />
  )
}

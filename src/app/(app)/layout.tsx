import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { Topbar } from '@/components/layout/Topbar'
import { Sidebar } from '@/components/layout/Sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen flex-col bg-surface-subtle">
      <Topbar user={user} />
      <div className="flex flex-1">
        {/* Sidebar for every role from `md` up; below `md` the header hamburger (MobileNav)
            provides the same navigation. */}
        <Sidebar role={user.role} />
        <main className="flex-1 px-4 py-5 sm:px-6">
          <div className="mx-auto w-full max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

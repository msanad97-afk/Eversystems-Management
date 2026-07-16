import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { Topbar } from '@/components/layout/Topbar'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const isSupervisor = user.role === 'SUPERVISOR'

  return (
    <div className="flex min-h-screen flex-col bg-surface-subtle">
      <Topbar user={user} />
      <div className="flex flex-1">
        {!isSupervisor && <Sidebar role={user.role} />}
        <main className={`flex-1 px-4 py-5 sm:px-6 ${isSupervisor ? 'pb-24' : ''}`}>
          <div className="mx-auto w-full max-w-4xl">{children}</div>
        </main>
      </div>
      {isSupervisor && <BottomNav />}
    </div>
  )
}

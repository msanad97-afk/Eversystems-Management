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
        {/* min-w-0 lets this flex child shrink below its content's intrinsic width, so a wide
            table scrolls inside its own overflow-x-auto container instead of stretching the page.
            overflow-x-clip is ONLY a safety net: if something still overflows, the PAGE won't
            scroll sideways — but the correct fix for any future overflow is min-w-0 on the
            offending flex ancestor, never to rely on this clip. */}
        <main className="min-w-0 flex-1 overflow-x-clip px-4 py-5 sm:px-6">
          <div className="mx-auto w-full min-w-0 max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { loadSupervisorScopeOptions } from '@/lib/materialRequests/scopeOptions.server'
import { RequestForm } from '@/components/materialRequests/RequestForm'

export const dynamic = 'force-dynamic'

export default async function NewRequestPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'SUPERVISOR') redirect('/')

  const { projects, materials } = await loadSupervisorScopeOptions(user.id)

  return (
    <div className="space-y-4">
      <div>
        <Link href="/requests" className="text-sm font-medium text-primary-700 hover:underline">← Requests</Link>
        <h1 className="mt-1 text-xl font-semibold text-fg">New material request</h1>
      </div>
      <RequestForm projects={projects} materials={materials} />
    </div>
  )
}

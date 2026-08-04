import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { canEditRequest } from '@/lib/materialRequests/rules'
import { loadSupervisorScopeOptions } from '@/lib/materialRequests/scopeOptions.server'
import { RequestForm } from '@/components/materialRequests/RequestForm'
import type { ExistingRequest } from '@/components/materialRequests/types'

export const dynamic = 'force-dynamic'

export default async function EditRequestPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'SUPERVISOR') redirect('/')

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true, requestedById: true, status: true, projectId: true, assetId: true, activityId: true,
      lines: { orderBy: { sortOrder: 'asc' }, select: { materialId: true, requestedQty: true, note: true } },
    },
  })
  if (!request) notFound()
  if (request.requestedById !== user.id) redirect('/')
  if (!canEditRequest(request.status)) redirect(`/requests/${request.id}`)

  const { projects, materials } = await loadSupervisorScopeOptions(user.id)
  const existing: ExistingRequest = {
    id: request.id,
    projectId: request.projectId,
    assetId: request.assetId,
    activityId: request.activityId,
    lines: request.lines.map((l) => ({ materialId: l.materialId, requestedQty: Number(l.requestedQty), note: l.note })),
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/requests/${request.id}`} className="text-sm font-medium text-primary-700 hover:underline">← Back</Link>
        <h1 className="mt-1 text-xl font-semibold text-fg">Edit request</h1>
      </div>
      <RequestForm projects={projects} materials={materials} existing={existing} />
    </div>
  )
}

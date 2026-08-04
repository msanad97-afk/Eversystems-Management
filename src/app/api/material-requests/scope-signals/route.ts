import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { isNonEmptyString } from '@/lib/validation'
import { loadScopeSignals } from '@/lib/materialRequests/signals.server'

/**
 * Quantities-only budget signals for a request scope, feeding the supervisor "new request"
 * form live. Deliberately no cost: {@link loadScopeSignals} never reads a cost field, and
 * this route never touches cost.server.ts. Members of the project (or ADMIN) only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const sp = req.nextUrl.searchParams
  const projectId = isNonEmptyString(sp.get('projectId')) ? sp.get('projectId')! : null
  if (!projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
  const assetId = isNonEmptyString(sp.get('assetId')) ? sp.get('assetId') : null
  const activityId = isNonEmptyString(sp.get('activityId')) ? sp.get('activityId') : null
  const excludeRequestId = isNonEmptyString(sp.get('excludeRequestId')) ? sp.get('excludeRequestId')! : undefined

  // Non-admins may only read signals for projects they are assigned to.
  if (guard.user.role !== 'ADMIN') {
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: guard.user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'You are not assigned to this project.' }, { status: 403 })
  }

  const signals = await loadScopeSignals({ projectId, assetId, activityId }, excludeRequestId)
  return NextResponse.json({ signals })
}

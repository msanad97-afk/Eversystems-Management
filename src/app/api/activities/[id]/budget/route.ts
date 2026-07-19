import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth/permissions'
import { loadActivityBudget } from '@/lib/budget.server'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole('ADMIN', 'VIEWER')
  if ('error' in guard) return guard.error

  const activity = await prisma.activity.findUnique({
    where: { id: params.id },
    select: { id: true, asset: { select: { projectId: true } } },
  })
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })

  if (guard.user.role === 'VIEWER') {
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: activity.asset.projectId, userId: guard.user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const budget = await loadActivityBudget(params.id)
  return NextResponse.json({ budget })
}

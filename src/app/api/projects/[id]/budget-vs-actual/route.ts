import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth/permissions'
import { loadBudgetVsActual } from '@/lib/actuals.server'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole('ADMIN', 'VIEWER')
  if ('error' in guard) return guard.error

  if (guard.user.role === 'VIEWER') {
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: params.id, userId: guard.user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const data = await loadBudgetVsActual(params.id)
  if (!data) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ budgetVsActual: data })
}

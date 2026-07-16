import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth/permissions'
import { activityLedger } from '@/lib/reports/progress'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole('ADMIN', 'VIEWER')
  if ('error' in guard) return guard.error

  const ledger = await activityLedger(params.id)
  if (!ledger) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })

  // VIEWER may only read progress on projects they are a member of.
  if (guard.user.role === 'VIEWER') {
    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: ledger.activity.projectId, userId: guard.user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  return NextResponse.json({ ledger })
}

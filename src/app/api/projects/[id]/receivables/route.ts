import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadReceivables, loadAdvanceBlock } from '@/lib/cash.server'

const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** One project's receivables + advance block. ADMIN-only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const [receivables, advance] = await Promise.all([
    loadReceivables({ projectId: project.id, today: utcDay() }),
    loadAdvanceBlock(project.id),
  ])
  return NextResponse.json({ receivables, advance })
}

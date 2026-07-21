import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { validateBaseline, type BaselinePoint } from '@/lib/evm'

/** The baseline S-curve. ADMIN-only; the single mutation in Phase 6C. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const rows = await prisma.baselinePeriod.findMany({
    where: { projectId: params.id },
    orderBy: { periodMonth: 'asc' },
    select: { periodMonth: true, cumPlannedPct: true },
  })
  return NextResponse.json({
    baseline: rows.map((r) => ({ periodMonth: r.periodMonth.toISOString().slice(0, 10), cumPlannedPct: Number(r.cumPlannedPct) })),
  })
}

/**
 * Replace the WHOLE curve atomically. Partial edits are not supported — the client always
 * sends the complete ordered list. An empty list clears the baseline (PV → null).
 * Validate → single transaction (never half-writes) → BASELINE_UPDATED.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const raw = Array.isArray(body?.baseline) ? body.baseline : null
  if (!raw) return NextResponse.json({ error: 'Body must be { baseline: [{ periodMonth, cumPlannedPct }] }.' }, { status: 400 })

  const points: BaselinePoint[] = []
  for (const p of raw) {
    if (typeof p !== 'object' || p === null || typeof (p as { periodMonth?: unknown }).periodMonth !== 'string') {
      return NextResponse.json({ error: 'Each period needs a periodMonth (YYYY-MM-01).' }, { status: 400 })
    }
    const rec = p as { periodMonth: string; cumPlannedPct: unknown }
    const pct = Number(rec.cumPlannedPct)
    if (!Number.isFinite(pct)) return NextResponse.json({ error: `Invalid cumulative percent for ${rec.periodMonth}.` }, { status: 400 })
    points.push({ periodMonth: rec.periodMonth, cumPlannedPct: pct })
  }

  const errors = validateBaseline(points)
  if (errors.length > 0) return NextResponse.json({ error: errors[0]!.message, errors }, { status: 400 })

  await prisma.$transaction(async (tx) => {
    await tx.baselinePeriod.deleteMany({ where: { projectId: params.id } })
    if (points.length > 0) {
      await tx.baselinePeriod.createMany({
        data: points.map((p) => ({
          projectId: params.id,
          periodMonth: new Date(`${p.periodMonth}T00:00:00.000Z`),
          cumPlannedPct: p.cumPlannedPct,
        })),
      })
    }
  })

  writeAuditLog({
    action: 'BASELINE_UPDATED',
    userId: guard.user.id,
    projectId: project.id,
    entity: 'Project',
    entityId: project.id,
    entityCode: project.projectCode,
    metadata: { periods: points.length, first: points[0]?.periodMonth ?? null, last: points[points.length - 1]?.periodMonth ?? null },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, periods: points.length })
}

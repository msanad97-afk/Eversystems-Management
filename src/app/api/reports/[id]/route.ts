import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canReadReport, canAuthorReport } from '@/lib/reports/query'
import { canEdit, validateCaps, WEATHER_OPTIONS, type ActivityInput } from '@/lib/reports/rules'
import { remainingByActivity } from '@/lib/reports/progress'

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

const reportInclude = {
  project: { select: { id: true, projectCode: true, name: true } },
  author: { select: { id: true, firstName: true, lastName: true } },
  activities: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      activity: { select: { name: true, ref: true, unit: true, isActive: true, asset: { select: { name: true } } } },
      manpower: { include: { category: { select: { name: true, isActive: true } } } },
      materials: { include: { material: { select: { name: true, unit: true, isActive: true } } } },
    },
  },
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({ where: { id: params.id }, include: reportInclude })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canReadReport(scope, report)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const editable = canAuthorReport(scope, report) && canEdit(report.status)

  return NextResponse.json({
    report: {
      id: report.id,
      reportCode: report.reportCode,
      reportDate: report.reportDate.toISOString().slice(0, 10),
      status: report.status,
      weather: report.weather,
      generalNotes: report.generalNotes,
      submittedAt: report.submittedAt ? report.submittedAt.toISOString() : null,
      reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
      reviewNote: report.reviewNote,
      project: report.project,
      author: { id: report.author.id, name: `${report.author.firstName} ${report.author.lastName}` },
      editable,
      activities: report.activities.map((ra) => ({
        id: ra.id,
        activityId: ra.activityId,
        assetName: ra.activity.asset.name,
        activityRef: ra.activity.ref,
        activityName: ra.activity.name,
        unit: ra.activity.unit,
        activityActive: ra.activity.isActive,
        quantityDone: Number(ra.quantityDone),
        note: ra.note,
        manpower: ra.manpower.map((m) => ({
          id: m.id, categoryId: m.categoryId, categoryName: m.category.name,
          categoryActive: m.category.isActive, headcount: m.headcount, hours: Number(m.hours), notes: m.notes,
        })),
        materials: ra.materials.map((m) => ({
          id: m.id, materialId: m.materialId, materialName: m.material.name, unit: m.material.unit,
          materialActive: m.material.isActive, quantity: Number(m.quantity), notes: m.notes,
        })),
      })),
    },
  })
}

interface ParsedActivity {
  activityId: string
  quantityDone: number
  note: string | null
  manpower: { categoryId: string; headcount: number; hours: number; notes: string | null }[]
  materials: { materialId: string; quantity: number; notes: string | null }[]
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, projectId: true, status: true, reportCode: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) {
    return NextResponse.json({ error: 'You can only edit your own reports.' }, { status: 403 })
  }
  if (!canEdit(report.status)) {
    return NextResponse.json({ error: 'This report can no longer be edited.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const weather =
    typeof body.weather === 'string' && (WEATHER_OPTIONS as readonly string[]).includes(body.weather)
      ? body.weather
      : null
  const generalNotes = str(body.generalNotes)

  const rawActivities: unknown[] = Array.isArray(body.activities) ? body.activities : []
  const parsed: ParsedActivity[] = rawActivities
    .filter((a): a is Record<string, unknown> => isRecord(a) && typeof a.activityId === 'string')
    .map((a) => {
      const rawM: unknown[] = Array.isArray(a.manpower) ? a.manpower : []
      const rawX: unknown[] = Array.isArray(a.materials) ? a.materials : []
      return {
        activityId: a.activityId as string,
        quantityDone: num(a.quantityDone),
        note: str(a.note),
        manpower: rawM
          .filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.categoryId === 'string')
          .map((m) => ({ categoryId: m.categoryId as string, headcount: Math.trunc(num(m.headcount)), hours: num(m.hours), notes: str(m.notes) })),
        materials: rawX
          .filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.materialId === 'string')
          .map((m) => ({ materialId: m.materialId as string, quantity: num(m.quantity), notes: str(m.notes) })),
      }
    })

  // One row per activity (schema @@unique([reportId, activityId])).
  if (new Set(parsed.map((a) => a.activityId)).size !== parsed.length) {
    return NextResponse.json({ error: 'Each activity can appear only once per report.' }, { status: 400 })
  }
  // Per-activity: one manpower row per category, one material row per material.
  for (const a of parsed) {
    if (new Set(a.manpower.map((m) => m.categoryId)).size !== a.manpower.length) {
      return NextResponse.json({ error: 'Each labor category can appear only once per activity.' }, { status: 400 })
    }
    if (new Set(a.materials.map((m) => m.materialId)).size !== a.materials.length) {
      return NextResponse.json({ error: 'Each material can appear only once per activity.' }, { status: 400 })
    }
  }

  const activityIds = parsed.map((a) => a.activityId)
  const categoryIds = [...new Set(parsed.flatMap((a) => a.manpower.map((m) => m.categoryId)))]
  const materialIds = [...new Set(parsed.flatMap((a) => a.materials.map((m) => m.materialId)))]

  // Referenced activities must belong to this project; catalog ids must exist.
  const acts = await prisma.activity.findMany({
    where: { id: { in: activityIds } },
    select: { id: true, name: true, unit: true, asset: { select: { projectId: true } } },
  })
  if (acts.length !== activityIds.length || acts.some((a) => a.asset.projectId !== report.projectId)) {
    return NextResponse.json({ error: 'Unknown activity for this project.' }, { status: 400 })
  }
  if (categoryIds.length > 0 && (await prisma.laborCategory.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) {
    return NextResponse.json({ error: 'Unknown labor category.' }, { status: 400 })
  }
  if (materialIds.length > 0 && (await prisma.material.count({ where: { id: { in: materialIds } } })) !== materialIds.length) {
    return NextResponse.json({ error: 'Unknown material.' }, { status: 400 })
  }

  // BOQ cap — enforced on draft save too (excluding this report).
  const remaining = await remainingByActivity(activityIds, report.id)
  const meta = new Map(acts.map((a) => [a.id, a]))
  const capInputs: ActivityInput[] = parsed.map((a) => ({
    activityId: a.activityId,
    activityName: meta.get(a.activityId)?.name,
    unit: meta.get(a.activityId)?.unit ?? undefined,
    quantityDone: a.quantityDone,
    remaining: remaining.get(a.activityId)?.remaining ?? 0,
    manpower: a.manpower,
    materials: a.materials,
  }))
  const capError = validateCaps(capInputs)
  if (capError) return NextResponse.json({ error: capError }, { status: 400 })

  await prisma.$transaction(async (tx) => {
    await tx.reportActivity.deleteMany({ where: { reportId: report.id } })
    await tx.dailyReport.update({
      where: { id: report.id },
      data: {
        weather,
        generalNotes,
        activities: {
          create: parsed.map((a, i) => ({
            activityId: a.activityId,
            quantityDone: a.quantityDone,
            note: a.note,
            sortOrder: i,
            manpower: { create: a.manpower },
            materials: { create: a.materials },
          })),
        },
      },
    })
  })

  writeAuditLog({
    action: 'REPORT_UPDATED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'DailyReport',
    entityId: report.id,
    entityCode: report.reportCode,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}

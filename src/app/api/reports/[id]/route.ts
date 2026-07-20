import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canReadReport, canAuthorReport } from '@/lib/reports/query'
import { canEdit, validateSubActivities, WEATHER_OPTIONS, type SubActivityInput } from '@/lib/reports/rules'
import { remainingBySubActivity, lumpsumFloorBySubActivity } from '@/lib/reports/progress'

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
      activity: { select: { name: true, ref: true, unit: true, asset: { select: { name: true } } } },
      subActivities: {
        orderBy: { sortOrder: 'asc' as const },
        include: {
          subActivity: { select: { name: true, isImplicit: true, type: true } },
          manpower: { include: { category: { select: { name: true } } } },
          materials: { include: { material: { select: { name: true, unit: true } } } },
        },
      },
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

  return NextResponse.json({
    report: {
      id: report.id,
      reportCode: report.reportCode,
      reportDate: report.reportDate.toISOString().slice(0, 10),
      status: report.status,
      weather: report.weather,
      generalNotes: report.generalNotes,
      editable: canAuthorReport(scope, report) && canEdit(report.status),
      activities: report.activities.map((ra) => ({
        activityId: ra.activityId,
        activityName: ra.activity.name,
        assetName: ra.activity.asset.name,
        subActivities: ra.subActivities.map((rs) => ({
          subActivityId: rs.subActivityId,
          name: rs.subActivity.name,
          type: rs.subActivity.type,
          isImplicit: rs.subActivity.isImplicit,
          quantityDone: rs.quantityDone == null ? null : Number(rs.quantityDone),
          percentComplete: rs.percentComplete == null ? null : Number(rs.percentComplete),
          note: rs.note,
          manpower: rs.manpower.map((m) => ({ categoryId: m.categoryId, categoryName: m.category.name, headcount: m.headcount, hours: Number(m.hours) })),
          materials: rs.materials.map((m) => ({ materialId: m.materialId, materialName: m.material.name, unit: m.material.unit, quantity: Number(m.quantity) })),
        })),
      })),
    },
  })
}

interface ParsedSub {
  subActivityId: string
  quantityDone: number
  percentComplete: number
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
  if (!canAuthorReport(scope, report)) return NextResponse.json({ error: 'You can only edit your own reports.' }, { status: 403 })
  if (!canEdit(report.status)) return NextResponse.json({ error: 'This report can no longer be edited.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const weather =
    typeof body.weather === 'string' && (WEATHER_OPTIONS as readonly string[]).includes(body.weather) ? body.weather : null
  const generalNotes = str(body.generalNotes)

  const raw: unknown[] = Array.isArray(body.subActivities) ? body.subActivities : []
  const parsed: ParsedSub[] = raw
    .filter((s): s is Record<string, unknown> => isRecord(s) && typeof s.subActivityId === 'string')
    .map((s) => {
      const rawM: unknown[] = Array.isArray(s.manpower) ? s.manpower : []
      const rawX: unknown[] = Array.isArray(s.materials) ? s.materials : []
      return {
        subActivityId: s.subActivityId as string,
        quantityDone: num(s.quantityDone),
        percentComplete: num(s.percentComplete),
        note: str(s.note),
        manpower: rawM
          .filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.categoryId === 'string')
          .map((m) => ({ categoryId: m.categoryId as string, headcount: Math.trunc(num(m.headcount)), hours: num(m.hours), notes: str(m.notes) })),
        materials: rawX
          .filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.materialId === 'string')
          .map((m) => ({ materialId: m.materialId as string, quantity: num(m.quantity), notes: str(m.notes) })),
      }
    })

  if (new Set(parsed.map((s) => s.subActivityId)).size !== parsed.length) {
    return NextResponse.json({ error: 'Each sub-activity can appear only once per report.' }, { status: 400 })
  }
  for (const s of parsed) {
    if (new Set(s.manpower.map((m) => m.categoryId)).size !== s.manpower.length) {
      return NextResponse.json({ error: 'Each labour category can appear only once per line.' }, { status: 400 })
    }
    if (new Set(s.materials.map((m) => m.materialId)).size !== s.materials.length) {
      return NextResponse.json({ error: 'Each material can appear only once per line.' }, { status: 400 })
    }
  }

  const subIds = parsed.map((s) => s.subActivityId)
  const categoryIds = [...new Set(parsed.flatMap((s) => s.manpower.map((m) => m.categoryId)))]
  const materialIds = [...new Set(parsed.flatMap((s) => s.materials.map((m) => m.materialId)))]

  // Sub-activities must belong to this project (via their activity → asset).
  const subs = await prisma.subActivity.findMany({
    where: { id: { in: subIds } },
    select: { id: true, name: true, type: true, activityId: true, activity: { select: { id: true, unit: true, boqQuantity: true, asset: { select: { projectId: true } } } } },
  })
  if (subs.length !== subIds.length || subs.some((s) => s.activity.asset.projectId !== report.projectId)) {
    return NextResponse.json({ error: 'Unknown sub-activity for this project.' }, { status: 400 })
  }
  if (categoryIds.length > 0 && (await prisma.laborCategory.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) {
    return NextResponse.json({ error: 'Unknown labour category.' }, { status: 400 })
  }
  if (materialIds.length > 0 && (await prisma.material.count({ where: { id: { in: materialIds } } })) !== materialIds.length) {
    return NextResponse.json({ error: 'Unknown material.' }, { status: 400 })
  }

  // Caps (measured, excluding this report) + lumpsum floors (approved).
  const lumpsumIds = subs.filter((s) => s.type === 'LUMPSUM').map((s) => s.id)
  const [remaining, floors] = await Promise.all([
    remainingBySubActivity(subIds, report.id),
    lumpsumFloorBySubActivity(lumpsumIds),
  ])
  const meta = new Map(subs.map((s) => [s.id, s]))
  const capInputs: SubActivityInput[] = parsed.map((s) => {
    const m = meta.get(s.subActivityId)!
    return {
      subActivityId: s.subActivityId,
      label: m.name,
      type: m.type as 'MEASURED' | 'LUMPSUM',
      unit: m.activity.unit ?? undefined,
      quantityDone: s.quantityDone,
      remaining: remaining.get(s.subActivityId)?.remaining ?? 0,
      percentComplete: s.percentComplete,
      lastApprovedPercent: floors.get(s.subActivityId) ?? 0,
      manpower: s.manpower,
      materials: s.materials,
    }
  })
  const capError = validateSubActivities(capInputs)
  if (capError) return NextResponse.json({ error: capError }, { status: 400 })

  // Group sub-activities under their parent activity (ReportActivity is the group).
  const byActivity = new Map<string, ParsedSub[]>()
  for (const s of parsed) {
    const actId = meta.get(s.subActivityId)!.activityId
    const list = byActivity.get(actId) ?? []
    list.push(s)
    byActivity.set(actId, list)
  }

  await prisma.$transaction(async (tx) => {
    await tx.reportActivity.deleteMany({ where: { reportId: report.id } })
    await tx.dailyReport.update({
      where: { id: report.id },
      data: {
        weather,
        generalNotes,
        activities: {
          create: [...byActivity.entries()].map(([activityId, list], ai) => ({
            activityId,
            sortOrder: ai,
            subActivities: {
              create: list.map((s, si) => {
                const isLumpsum = meta.get(s.subActivityId)!.type === 'LUMPSUM'
                return {
                  subActivityId: s.subActivityId,
                  quantityDone: isLumpsum ? null : s.quantityDone,
                  percentComplete: isLumpsum ? s.percentComplete : null,
                  note: s.note,
                  sortOrder: si,
                  manpower: { create: s.manpower },
                  materials: { create: s.materials },
                }
              }),
            },
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

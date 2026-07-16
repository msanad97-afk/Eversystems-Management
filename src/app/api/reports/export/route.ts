import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth/permissions'
import { getReportScope } from '@/lib/reports/access'
import { buildReportListWhere, type ReportFilters } from '@/lib/reports/query'
import { cumulativePercent } from '@/lib/reports/rules'
import type { ReportStatus } from '@prisma/client'

function parseStatus(v: string | null): ReportStatus | null {
  const all: ReportStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']
  return v && (all as string[]).includes(v) ? (v as ReportStatus) : null
}
function parseDateParam(v: string | null): Date | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

const HEADER = [
  'Report Code', 'Date', 'Project Code', 'Project', 'Author', 'Status',
  'Asset', 'Activity', 'Unit', 'Line Type', 'Qty Done', 'Cumulative Qty', 'Cumulative %',
  'Item', 'Headcount', 'Hours', 'Man-Hours', 'Material Qty', 'Notes',
]

export async function GET(req: NextRequest) {
  const guard = await requireRole('ADMIN', 'VIEWER')
  if ('error' in guard) return guard.error

  const scope = await getReportScope(guard.user.id, guard.user.role)
  const sp = req.nextUrl.searchParams
  const filters: ReportFilters = {
    projectId: sp.get('projectId'),
    from: parseDateParam(sp.get('from')),
    to: parseDateParam(sp.get('to')),
    status: parseStatus(sp.get('status')),
    authorId: sp.get('authorId'),
  }
  const where = buildReportListWhere(scope, filters)

  const reports = await prisma.dailyReport.findMany({
    where,
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, reportCode: true, reportDate: true, status: true, weather: true,
      project: { select: { projectCode: true, name: true } },
      author: { select: { firstName: true, lastName: true } },
      activities: {
        orderBy: { sortOrder: 'asc' },
        select: {
          activityId: true, quantityDone: true, note: true,
          activity: { select: { name: true, unit: true, boqQuantity: true, asset: { select: { name: true } } } },
          manpower: { select: { headcount: true, hours: true, notes: true, category: { select: { name: true } } } },
          materials: { select: { quantity: true, notes: true, material: { select: { name: true, unit: true } } } },
        },
      },
    },
  })

  // Committed (SUBMITTED+APPROVED) running cumulative per (report, activity), for the
  // Cumulative Qty/% on ACTIVITY lines. Non-committed lines (draft/rejected) leave it blank.
  const activityIds = [...new Set(reports.flatMap((r) => r.activities.map((a) => a.activityId)))]
  const cumByKey = new Map<string, number>()
  if (activityIds.length > 0) {
    const committed = await prisma.reportActivity.findMany({
      where: { activityId: { in: activityIds }, report: { status: { in: ['SUBMITTED', 'APPROVED'] } } },
      orderBy: [{ report: { reportDate: 'asc' } }, { report: { createdAt: 'asc' } }],
      select: { activityId: true, quantityDone: true, reportId: true },
    })
    const running = new Map<string, number>()
    for (const ra of committed) {
      const r = (running.get(ra.activityId) ?? 0) + Number(ra.quantityDone)
      running.set(ra.activityId, r)
      cumByKey.set(`${ra.reportId}|${ra.activityId}`, r)
    }
  }

  const rows: string[] = [HEADER.map(cell).join(',')]

  for (const r of reports) {
    const base = [
      r.reportCode,
      r.reportDate.toISOString().slice(0, 10),
      r.project.projectCode,
      r.project.name,
      `${r.author.firstName} ${r.author.lastName}`,
      r.status,
    ]
    if (r.activities.length === 0) {
      rows.push([...base, '', '', '', 'REPORT', '', '', '', '', '', '', '', '', ''].map(cell).join(','))
      continue
    }
    for (const a of r.activities) {
      const boq = Number(a.activity.boqQuantity)
      const cum = cumByKey.get(`${r.id}|${a.activityId}`)
      const pct = cum !== undefined ? round1(cumulativePercent(cum, boq)) : ''
      // ACTIVITY line
      rows.push(
        [...base, a.activity.asset.name, a.activity.name, a.activity.unit, 'ACTIVITY',
          Number(a.quantityDone), cum ?? '', pct, '', '', '', '', '', a.note ?? ''].map(cell).join(','),
      )
      for (const m of a.manpower) {
        rows.push(
          [...base, a.activity.asset.name, a.activity.name, a.activity.unit, 'MANPOWER',
            '', '', '', m.category.name, m.headcount, Number(m.hours), m.headcount * Number(m.hours), '', m.notes ?? ''].map(cell).join(','),
        )
      }
      for (const m of a.materials) {
        rows.push(
          [...base, a.activity.asset.name, a.activity.name, a.activity.unit, 'MATERIAL',
            '', '', '', `${m.material.name} (${m.material.unit})`, '', '', '', Number(m.quantity), m.notes ?? ''].map(cell).join(','),
        )
      }
    }
  }

  const csv = '﻿' + rows.join('\r\n')
  const filename = `reports-export-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

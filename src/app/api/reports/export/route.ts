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
const round1 = (n: number) => Math.round(n * 10) / 10
const round3 = (n: number) => Math.round(n * 1000) / 1000

const HEADER = [
  'Report Code', 'Date', 'Project Code', 'Project', 'Author', 'Status',
  'Asset', 'Activity', 'Sub-Activity', 'Unit', 'Line Type',
  'Qty Done', 'Cumulative Qty', 'Cumulative %', '% Complete', 'Earned BHD',
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
      id: true, reportCode: true, reportDate: true, status: true,
      project: { select: { projectCode: true, name: true } },
      author: { select: { firstName: true, lastName: true } },
      activities: {
        orderBy: { sortOrder: 'asc' },
        select: {
          activity: { select: { name: true, unit: true, boqQuantity: true, asset: { select: { name: true } } } },
          subActivities: {
            orderBy: { sortOrder: 'asc' },
            select: {
              subActivityId: true, quantityDone: true, percentComplete: true, note: true,
              subActivity: { select: { name: true, isImplicit: true, type: true, lumpsumBhd: true } },
              manpower: { select: { headcount: true, hours: true, notes: true, category: { select: { name: true } } } },
              materials: { select: { quantity: true, notes: true, material: { select: { name: true, unit: true } } } },
            },
          },
        },
      },
    },
  })

  // Committed (SUBMITTED+APPROVED) running cumulative per (report, sub-activity), measured only.
  const subIds = [...new Set(reports.flatMap((r) => r.activities.flatMap((a) => a.subActivities.map((s) => s.subActivityId))))]
  const cumByKey = new Map<string, number>()
  if (subIds.length > 0) {
    const committed = await prisma.reportSubActivity.findMany({
      where: { subActivityId: { in: subIds }, quantityDone: { not: null }, reportActivity: { report: { status: { in: ['SUBMITTED', 'APPROVED'] } } } },
      orderBy: [{ reportActivity: { report: { reportDate: 'asc' } } }, { reportActivity: { report: { createdAt: 'asc' } } }],
      select: { subActivityId: true, quantityDone: true, reportActivity: { select: { reportId: true } } },
    })
    const running = new Map<string, number>()
    for (const rs of committed) {
      const r = (running.get(rs.subActivityId) ?? 0) + Number(rs.quantityDone)
      running.set(rs.subActivityId, r)
      cumByKey.set(`${rs.reportActivity.reportId}|${rs.subActivityId}`, r)
    }
  }

  const rows: string[] = [HEADER.map(cell).join(',')]

  for (const r of reports) {
    const base = [
      r.reportCode, r.reportDate.toISOString().slice(0, 10), r.project.projectCode, r.project.name,
      `${r.author.firstName} ${r.author.lastName}`, r.status,
    ]
    const subCount = r.activities.reduce((n, a) => n + a.subActivities.length, 0)
    if (subCount === 0) {
      rows.push([...base, '', '', '', '', 'REPORT', '', '', '', '', '', '', '', '', '', '', ''].map(cell).join(','))
      continue
    }
    for (const a of r.activities) {
      const asset = a.activity.asset.name
      const boq = Number(a.activity.boqQuantity)
      for (const s of a.subActivities) {
        const subName = s.subActivity.isImplicit ? '' : s.subActivity.name
        const isLumpsum = s.subActivity.type === 'LUMPSUM'
        const cum = cumByKey.get(`${r.id}|${s.subActivityId}`)
        const pct = !isLumpsum && cum !== undefined ? round1(cumulativePercent(cum, boq)) : ''
        const lumpPct = isLumpsum && s.percentComplete != null ? Number(s.percentComplete) : ''
        const lumpBhd = isLumpsum && s.percentComplete != null && s.subActivity.lumpsumBhd != null ? round3((Number(s.percentComplete) / 100) * Number(s.subActivity.lumpsumBhd)) : ''
        rows.push(
          [...base, asset, a.activity.name, subName, a.activity.unit ?? '', isLumpsum ? 'LUMPSUM' : 'MEASURED',
            isLumpsum ? '' : Number(s.quantityDone ?? 0), cum ?? '', pct, lumpPct, lumpBhd, '', '', '', '', '', s.note ?? ''].map(cell).join(','),
        )
        for (const m of s.manpower) {
          rows.push([...base, asset, a.activity.name, subName, a.activity.unit ?? '', 'MANPOWER',
            '', '', '', '', '', m.category.name, m.headcount, Number(m.hours), m.headcount * Number(m.hours), '', m.notes ?? ''].map(cell).join(','))
        }
        for (const m of s.materials) {
          rows.push([...base, asset, a.activity.name, subName, a.activity.unit ?? '', 'MATERIAL',
            '', '', '', '', '', `${m.material.name} (${m.material.unit})`, '', '', '', Number(m.quantity), m.notes ?? ''].map(cell).join(','))
        }
      }
    }
  }

  const csv = '﻿' + rows.join('\r\n')
  const filename = `reports-export-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

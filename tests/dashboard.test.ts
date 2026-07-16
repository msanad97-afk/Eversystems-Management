import { describe, it, expect } from 'vitest'
import { aggregateDashboard, eachDay, isCounted, type DashboardInput } from '@/lib/dashboard'

const P1 = { id: 'p1', projectCode: 'PRJ-2026-001', name: 'Alpha' }
const P2 = { id: 'p2', projectCode: 'PRJ-2026-002', name: 'Beta' }

// Hand-worked example. Counted set (SUBMITTED/APPROVED): R1, R2, R3.
// Draft R4 and rejected R5 must be excluded everywhere.
const input: DashboardInput = {
  from: '2026-07-01',
  to: '2026-07-03',
  activeProjects: [P1, P2], // expected = 2 projects × 3 days = 6
  yesterdayReportedProjectIds: ['p1'], // P2 missing yesterday
  reports: [
    {
      projectId: 'p1', reportDate: '2026-07-01', status: 'APPROVED',
      manpower: [{ categoryName: 'Mason', headcount: 10, hours: 8 }, { categoryName: 'Helper', headcount: 30, hours: 8 }],
      materials: [{ materialName: 'OPC Cement', unit: 'bag', quantity: 120 }],
    },
    {
      projectId: 'p1', reportDate: '2026-07-02', status: 'SUBMITTED',
      manpower: [{ categoryName: 'Mason', headcount: 3, hours: 8 }],
      materials: [{ materialName: 'Rebar 12mm', unit: 'ton', quantity: 4.5 }],
    },
    {
      projectId: 'p2', reportDate: '2026-07-01', status: 'SUBMITTED',
      manpower: [{ categoryName: 'Carpenter', headcount: 5, hours: 8 }],
      materials: [],
    },
    {
      projectId: 'p2', reportDate: '2026-07-01', status: 'DRAFT', // excluded
      manpower: [{ categoryName: 'Mason', headcount: 100, hours: 8 }],
      materials: [{ materialName: 'OPC Cement', unit: 'bag', quantity: 999 }],
    },
    {
      projectId: 'p1', reportDate: '2026-07-03', status: 'REJECTED', // excluded
      manpower: [{ categoryName: 'Mason', headcount: 7, hours: 8 }],
      materials: [],
    },
  ],
  todayReports: [
    {
      projectId: 'p1', reportDate: '2026-07-10', status: 'APPROVED',
      manpower: [{ categoryName: 'Mason', headcount: 12, hours: 8 }, { categoryName: 'Helper', headcount: 8, hours: 8 }],
      materials: [],
    },
    {
      projectId: 'p2', reportDate: '2026-07-10', status: 'DRAFT', // excluded from "active workers today"
      manpower: [{ categoryName: 'Mason', headcount: 50, hours: 8 }],
      materials: [],
    },
  ],
}

describe('isCounted', () => {
  it('counts only SUBMITTED and APPROVED', () => {
    expect(isCounted('SUBMITTED')).toBe(true)
    expect(isCounted('APPROVED')).toBe(true)
    expect(isCounted('DRAFT')).toBe(false)
    expect(isCounted('REJECTED')).toBe(false)
  })
})

describe('eachDay', () => {
  it('lists inclusive civil dates', () => {
    expect(eachDay('2026-07-01', '2026-07-03')).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
  })
  it('returns empty when from > to', () => {
    expect(eachDay('2026-07-03', '2026-07-01')).toEqual([])
  })
})

describe('aggregateDashboard', () => {
  const r = aggregateDashboard(input)

  it('KPI: project-day coverage (submitted vs expected), drafts/rejected excluded', () => {
    // Distinct counted (project,date): (p1,01),(p1,02),(p2,01) = 3. Draft on (p2,01) does not add.
    expect(r.kpis.reportsSubmitted).toBe(3)
    expect(r.kpis.reportsExpected).toBe(6)
  })

  it('KPI: total man-hours excludes drafts and rejected', () => {
    // R1: 10*8 + 30*8 = 320; R2: 3*8 = 24; R3: 5*8 = 40 → 384. (Draft 800, rejected 56 excluded.)
    expect(r.kpis.totalManHours).toBe(384)
  })

  it('KPI: active workers today counts only counted reports dated today', () => {
    expect(r.kpis.activeWorkersToday).toBe(20) // 12 + 8; draft 50 excluded
  })

  it('man-hours per day stacked by category matches hand totals', () => {
    expect(r.manHoursPerDay.days).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
    expect(r.manHoursPerDay.categories).toEqual(['Carpenter', 'Helper', 'Mason'])
    const byDate = Object.fromEntries(r.manHoursPerDay.rows.map((x) => [x.date, x]))
    expect(byDate['2026-07-01']!.byCategory).toEqual({ Mason: 80, Helper: 240, Carpenter: 40 })
    expect(byDate['2026-07-01']!.total).toBe(360)
    expect(byDate['2026-07-02']!.byCategory).toEqual({ Mason: 24 })
    expect(byDate['2026-07-03']!.total).toBe(0) // rejected report contributes nothing
    expect(r.manHoursPerDay.max).toBe(360)
  })

  it('material totals sum quantities, drafts excluded', () => {
    expect(r.materialTotals).toEqual([
      { materialName: 'OPC Cement', unit: 'bag', total: 120 }, // draft's 999 excluded
      { materialName: 'Rebar 12mm', unit: 'ton', total: 4.5 },
    ])
  })

  it('missing-report alert lists active projects with no counted report yesterday', () => {
    expect(r.missingYesterday).toEqual([{ projectCode: 'PRJ-2026-002', name: 'Beta' }])
  })
})

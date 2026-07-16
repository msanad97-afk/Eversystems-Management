import { describe, it, expect } from 'vitest'
import { renderReportPdf } from '@/lib/pdf/render'
import { type ReportPdfData } from '@/lib/pdf/ReportPdf'

function sample(notes: string): ReportPdfData {
  return {
    reportCode: 'DR-2026-0001',
    reportDate: '2026-07-14',
    status: 'APPROVED',
    weather: 'Hot',
    generalNotes: notes,
    project: { name: 'Site Alpha', projectCode: 'PRJ-2026-001', location: 'Manama' },
    author: { name: 'Sam Supervisor' },
    activities: [
      {
        assetName: 'Tower A',
        activityName: 'Blockwork 200mm',
        ref: '3.2.1',
        unit: 'm2',
        quantityDone: 120,
        cumulativePercent: 24,
        note: 'Ground floor, block B',
        manpower: [
          { categoryName: 'Mason', headcount: 10, hours: 8 },
          { categoryName: 'Helper/Labourer', headcount: 33, hours: 8 },
        ],
        materials: [{ materialName: 'OPC Cement', unit: 'bag', quantity: 120 }],
      },
    ],
    totals: { workers: 43, manHours: 344 },
    generatedAt: '14/07/2026, 09:00:00',
  }
}

describe('ReportPdf render (English-only, activity-structured)', () => {
  it('renders a valid PDF buffer', async () => {
    const buf = await renderReportPdf(sample('No delays today.'))
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(1000)
  })

  it('renders with no activities and no notes', async () => {
    const data = sample('')
    data.generalNotes = null
    data.activities = []
    data.totals = { workers: 0, manHours: 0 }
    const buf = await renderReportPdf(data)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })
})

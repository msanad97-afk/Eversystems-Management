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
        subs: [
          {
            name: 'Base coat',
            isImplicit: false,
            type: 'MEASURED',
            unit: 'm2',
            quantityDone: 120,
            percentComplete: null,
            cumulativePercent: 24,
            earnedBhd: null,
            note: 'Ground floor, block B',
            manpower: [
              { categoryName: 'Mason', headcount: 10, hours: 8 },
              { categoryName: 'Helper/Labourer', headcount: 33, hours: 8 },
            ],
            materials: [{ materialName: 'OPC Cement', unit: 'bag', quantity: 120 }],
          },
          {
            name: 'Scaffolding',
            isImplicit: false,
            type: 'LUMPSUM',
            unit: '',
            quantityDone: null,
            percentComplete: 40,
            cumulativePercent: 40,
            earnedBhd: 1000,
            note: null,
            manpower: [],
            materials: [],
          },
        ],
      },
    ],
    totals: { workers: 43, manHours: 344 },
    generatedAt: '14/07/2026, 09:00:00',
  }
}

describe('ReportPdf render (English-only, sub-activity-structured)', () => {
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

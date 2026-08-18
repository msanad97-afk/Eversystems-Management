import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The read-only report view is a client component; render it to static markup to assert the
// stock-count section. Stub the client-only hooks it touches (router + toast) — irrelevant here.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

// esbuild transforms JSX with the classic runtime here, so the component references a global React.
;(globalThis as unknown as { React: typeof React }).React = React

import { ReportReadOnlyView, type ReportDetail } from '@/components/reports/ReportReadOnlyView'
import type { StockCountView } from '@/lib/inventory/stockCount.server'

const report: ReportDetail = {
  id: 'r1', reportCode: 'DR-2026-0001', reportDate: '2026-06-02', status: 'SUBMITTED',
  weather: null, generalNotes: null, reviewNote: null,
  project: { name: 'Site A', projectCode: 'PRJ-1' }, author: { name: 'Ann Author' }, activities: [],
}

const stockCount: StockCountView = {
  id: 'sc1', countedAt: '2026-06-02T09:00:00.000Z', countedByName: 'Sam Site', notes: 'partial count today',
  lines: [
    { id: 'l1', materialId: 'm1', materialName: 'Cement', countedQuantity: 55, systemQuantity: 60, variance: -5, unit: 'bag' }, // shortfall
    { id: 'l2', materialId: 'm2', materialName: 'Tile', countedQuantity: 25, systemQuantity: 20, variance: 5, unit: 'box' }, // surplus
  ],
}

const render = (sc: StockCountView | null) =>
  renderToStaticMarkup(React.createElement(ReportReadOnlyView, { report, canRecall: false, deliveries: [], stockCount: sc, canUploadAttachments: false }))

describe('read-only report — stock count section', () => {
  it('renders the count lines, the counter, notes, and site-perspective variance', () => {
    const html = render(stockCount)
    expect(html).toContain('Stock count')
    expect(html).toContain('Cement')
    expect(html).toContain('Tile')
    expect(html).toContain('Counted by Sam Site')
    expect(html).toContain('partial count today')
    // Variance from the site's perspective: cement short (−5), tile surplus (+5).
    expect(html).toContain('shortfall')
    expect(html).toContain('surplus')
    expect(html).toContain('system 60')
  })

  it('renders no section when the report has no stock count', () => {
    const html = render(null)
    expect(html).not.toContain('Stock count')
  })

  it('leaks no cost field into the serialized output', () => {
    const html = render(stockCount)
    for (const token of ['unitRate', 'costRate', 'costAtApproval', 'rateAtApproval', 'BHD']) {
      expect(html).not.toContain(token)
    }
  })
})

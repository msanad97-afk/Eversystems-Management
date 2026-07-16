import { describe, it, expect } from 'vitest'
import {
  buildReportListWhere,
  canReadReport,
  canAuthorReport,
  type ReportScope,
} from '@/lib/reports/query'

const supervisor: ReportScope = { role: 'SUPERVISOR', userId: 'sup1', memberProjectIds: ['p1', 'p2'] }
const viewer: ReportScope = { role: 'VIEWER', userId: 'v1', memberProjectIds: ['p1'] }
const admin: ReportScope = { role: 'ADMIN', userId: 'a1', memberProjectIds: [] }

describe('buildReportListWhere — role scoping', () => {
  it('locks a SUPERVISOR to their own reports', () => {
    expect(buildReportListWhere(supervisor)).toEqual({ authorId: 'sup1' })
  })
  it('ignores an authorId filter for a SUPERVISOR (cannot see others)', () => {
    const where = buildReportListWhere(supervisor, { authorId: 'someoneElse' })
    expect(where.authorId).toBe('sup1')
  })
  it('scopes a VIEWER to their member projects', () => {
    expect(buildReportListWhere(viewer)).toEqual({ projectId: { in: ['p1'] } })
  })
  it('lets a VIEWER filter within their projects, blocks projects they are not on', () => {
    expect(buildReportListWhere(viewer, { projectId: 'p1' }).projectId).toBe('p1')
    expect(buildReportListWhere(viewer, { projectId: 'p9' }).projectId).toBe('__none__')
  })
  it('does not scope an ADMIN', () => {
    expect(buildReportListWhere(admin)).toEqual({})
  })
  it('applies status and date filters', () => {
    const from = new Date('2026-07-01T00:00:00Z')
    const to = new Date('2026-07-31T00:00:00Z')
    const where = buildReportListWhere(admin, { status: 'SUBMITTED', from, to, authorId: 'x' })
    expect(where.status).toBe('SUBMITTED')
    expect(where.authorId).toBe('x')
    expect(where.reportDate).toEqual({ gte: from, lte: to })
  })
})

describe('canReadReport — supervisor isolation', () => {
  it('SUPERVISOR can read only their own reports', () => {
    expect(canReadReport(supervisor, { authorId: 'sup1', projectId: 'p1' })).toBe(true)
    expect(canReadReport(supervisor, { authorId: 'other', projectId: 'p1' })).toBe(false)
  })
  it('VIEWER can read reports on their projects only', () => {
    expect(canReadReport(viewer, { authorId: 'anyone', projectId: 'p1' })).toBe(true)
    expect(canReadReport(viewer, { authorId: 'anyone', projectId: 'p2' })).toBe(false)
  })
  it('ADMIN can read anything', () => {
    expect(canReadReport(admin, { authorId: 'x', projectId: 'z' })).toBe(true)
  })
})

describe('canAuthorReport — mutation is author-only', () => {
  it('only the author may mutate', () => {
    expect(canAuthorReport(supervisor, { authorId: 'sup1' })).toBe(true)
    expect(canAuthorReport(supervisor, { authorId: 'other' })).toBe(false)
    // even an admin is not the author of someone else's report
    expect(canAuthorReport(admin, { authorId: 'sup1' })).toBe(false)
  })
})

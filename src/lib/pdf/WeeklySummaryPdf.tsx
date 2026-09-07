import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { PdfHeader } from '@/lib/pdf/PdfHeader'
import type { WeeklySummaryData, WeeklyProjectPage } from '@/lib/weeklySummary.server'
import type { ActivityMatrix } from '@/lib/projectOverview.server'

// English-only, left-to-right Latin, Inter. This document CARRIES MONEY — management-to-management.

const BRAND = '#47715B'
const MOVE_BG = '#E7F0EA' // pale green — a cell that moved this week (never colour alone: +delta too)
const styles = StyleSheet.create({
  page: { paddingHorizontal: 40, paddingVertical: 36, fontFamily: 'Inter', fontSize: 9.5, color: '#1A1917' },
  subtitle: { fontSize: 10, color: '#5A5852', marginBottom: 2 },
  h1: { fontSize: 15, fontWeight: 600, color: '#1A1917' },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: BRAND, marginTop: 14, marginBottom: 6 },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  tile: { borderWidth: 1, borderColor: '#E4E3E0', borderRadius: 6, padding: 8, margin: 4, minWidth: 120 },
  tileLabel: { fontSize: 7.5, color: '#7C7A73', textTransform: 'uppercase' },
  tileValue: { fontSize: 13, fontWeight: 600, marginTop: 2 },
  tileSub: { fontSize: 7.5, color: '#7C7A73', marginTop: 1 },
  th: { flexDirection: 'row', backgroundColor: '#F5F5F3', borderBottomWidth: 1, borderBottomColor: '#D2D1CC' },
  thCell: { fontSize: 8, fontWeight: 600, color: '#5A5852', textTransform: 'uppercase', paddingVertical: 3, paddingHorizontal: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ECECEA' },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  muted: { color: '#7C7A73' },
  note: { marginTop: 3, lineHeight: 1.4 },
  flagItem: { flexDirection: 'row', marginBottom: 2 },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#A8A6A0' },
})

const round1 = (n: number) => Math.round(n * 10) / 10
const bhd0 = (n: number) => `BHD ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const pct1 = (n: number) => `${round1(n)}%`
const idx = (v: number | null) => (v == null ? 'N/A' : v.toFixed(2))
const signed = (n: number) => (n > 0 ? `+${round1(n)}` : `${round1(n)}`)

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  )
}

function Footer({ data }: { data: WeeklySummaryData }) {
  return (
    <View style={styles.footer} fixed>
      <Text>Eversystems Management · Weekly summary {data.week.startStr} → {data.week.endStr}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

// ─── Portfolio page ─────────────────────────────────────────────────────────
function PortfolioPage({ data }: { data: WeeklySummaryData }) {
  const p = data.portfolio
  const f = p.flags
  return (
    <Page size="A4" style={styles.page}>
      <PdfHeader title="Weekly Summary" />
      <Text style={styles.h1}>Portfolio — week of {data.week.label}</Text>
      <Text style={styles.subtitle}>Covers {data.week.startStr} (Sun) to {data.week.endStr} (Sat) · Generated {data.generatedAt}</Text>

      <Text style={styles.sectionTitle}>Across {p.activeProjectCount} active project{p.activeProjectCount === 1 ? '' : 's'}</Text>
      <View style={styles.tileRow}>
        <Tile label="Total contract value" value={bhd0(p.totalContractValue)} />
        <Tile label="Total BAC" value={bhd0(p.totalBac)} sub="budget at completion" />
        <Tile label="Actual cost to date" value={bhd0(p.totalActualCost)} sub="approved field cost" />
        <Tile label="Cash — cleared" value={bhd0(p.cashClearedBalance)} sub={`projected ${bhd0(p.cashProjectedBalance)}`} />
        <Tile label="Outstanding receivables" value={bhd0(p.outstandingReceivables)} sub="still to collect" />
        <Tile label="Reports filed" value={`${p.reportsFiled} / ${p.reportsExpected}`} sub="this week vs expected" />
      </View>
      <Text style={[styles.muted, styles.note, { fontSize: 7.5 }]}>{p.workingDaysNote}</Text>

      <Text style={styles.sectionTitle}>Projects</Text>
      <View style={styles.th}>
        <Text style={[styles.thCell, { flex: 1 }]}>Project</Text>
        <Text style={[styles.thCell, { width: 70, textAlign: 'right' }]}>Physical %</Text>
        <Text style={[styles.thCell, { width: 70, textAlign: 'right' }]}>Value %</Text>
        <Text style={[styles.thCell, { width: 80, textAlign: 'right' }]}>Week move</Text>
      </View>
      {p.rows.length === 0 ? (
        <Text style={[styles.muted, styles.note]}>No active projects.</Text>
      ) : (
        p.rows.map((r) => (
          <View key={r.id} style={styles.row}>
            <Text style={[styles.cell, { flex: 1 }]}>{r.name}</Text>
            <Text style={[styles.cell, { width: 70, textAlign: 'right' }]}>{pct1(r.physicalPercent)}</Text>
            <Text style={[styles.cell, { width: 70, textAlign: 'right' }]}>{pct1(r.valuePercent)}</Text>
            <Text style={[styles.cell, { width: 80, textAlign: 'right' }, r.movement > 0 ? { color: BRAND, fontWeight: 600 } : styles.muted]}>
              {r.movement > 0 ? signed(r.movement) : '—'}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Flagged this week</Text>
      {!f.anyFlag ? (
        <Text style={styles.muted}>Nothing flagged — every active project filed daily, and there are no open inventory alerts.</Text>
      ) : (
        <View>
          {f.missedReports.length > 0 && (
            <View style={{ marginBottom: 4 }}>
              <Text style={{ fontWeight: 600 }}>Missed reports</Text>
              {f.missedReports.map((m, i) => (
                <View key={i} style={styles.flagItem}><Text>• {m.name} — {m.daysMissed} day{m.daysMissed === 1 ? '' : 's'} with no report</Text></View>
              ))}
            </View>
          )}
          <FlagAlertGroup title="Negative inventory balances" alerts={f.negativeBalances} />
          <FlagAlertGroup title="Open count variances" alerts={f.countVariances} />
          <FlagAlertGroup title="Other open inventory alerts" alerts={f.otherAlerts} />
        </View>
      )}

      <Footer data={data} />
    </Page>
  )
}

function FlagAlertGroup({ title, alerts }: { title: string; alerts: WeeklySummaryData['portfolio']['flags']['negativeBalances'] }) {
  if (alerts.length === 0) return null
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={{ fontWeight: 600 }}>{title} ({alerts.length})</Text>
      {alerts.map((a) => (
        <View key={a.id} style={styles.flagItem}>
          <Text>• {a.projectName}{a.materialName ? ` — ${a.materialName}` : ''}{a.quantity != null ? ` (${a.quantity})` : ''}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── Per-project page ─────────────────────────────────────────────────────────
function MatrixTable({ activity }: { activity: ActivityMatrix }) {
  const { columns, rows } = activity
  const colW = columns.length > 0 ? Math.max(34, Math.min(60, Math.floor(230 / columns.length))) : 0
  return (
    <View style={{ marginBottom: 8 }} wrap={false}>
      <Text style={{ fontWeight: 600, marginBottom: 2 }}>{activity.ref ? `${activity.ref} · ` : ''}{activity.name}</Text>
      <View style={styles.th}>
        <Text style={[styles.thCell, { flex: 1 }]}>Asset</Text>
        <Text style={[styles.thCell, { width: 54, textAlign: 'right' }]}>BOQ</Text>
        {columns.map((c) => <Text key={c.key} style={[styles.thCell, { width: colW, textAlign: 'right' }]}>{c.name}</Text>)}
        <Text style={[styles.thCell, { width: 56, textAlign: 'right' }]}>Total %</Text>
      </View>
      {columns.length > 0 && (
        <View style={[styles.row, { backgroundColor: '#FBFBFA' }]}>
          <Text style={[styles.cell, styles.muted, { flex: 1, fontSize: 7.5 }]}>Weight</Text>
          <Text style={[styles.cell, { width: 54 }]} />
          {columns.map((c) => <Text key={c.key} style={[styles.cell, styles.muted, { width: colW, textAlign: 'right', fontSize: 7.5 }]}>{pct1(c.weightPct)}</Text>)}
          <Text style={[styles.cell, { width: 56 }]} />
        </View>
      )}
      {rows.map((r) => (
        <View key={r.assetId} style={styles.row}>
          <Text style={[styles.cell, { flex: 1 }]}>{r.assetName}{r.assetRef ? ` ${r.assetRef}` : ''}</Text>
          <Text style={[styles.cell, { width: 54, textAlign: 'right' }, styles.muted]}>{r.boqQuantity}{r.unit ? ` ${r.unit}` : ''}</Text>
          {r.cells.map((cell, i) => (
            <Text key={columns[i]!.key} style={[styles.cell, { width: colW, textAlign: 'right' }, cell?.delta != null ? { backgroundColor: MOVE_BG } : {}]}>
              {cell == null ? <Text style={styles.muted}>–</Text> : (
                <Text>{pct1(cell.percent)}{cell.delta != null ? <Text style={{ color: BRAND, fontWeight: 600 }}> +{round1(cell.delta)}</Text> : null}</Text>
              )}
            </Text>
          ))}
          <Text style={[styles.cell, { width: 56, textAlign: 'right', fontWeight: 600 }, r.totalDelta != null ? { backgroundColor: MOVE_BG } : {}]}>
            {pct1(r.totalPercent)}{r.totalDelta != null ? <Text style={{ color: BRAND }}> +{round1(r.totalDelta)}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  )
}

function ProjectPage({ page, data }: { page: WeeklyProjectPage; data: WeeklySummaryData }) {
  const m = page.money
  return (
    <Page size="A4" style={styles.page}>
      <PdfHeader title="Weekly Summary" />
      <Text style={styles.h1}>{page.name}</Text>
      <Text style={styles.subtitle}>{page.code} · week of {data.week.label}</Text>
      {!page.hadActivityThisWeek && (
        <Text style={[styles.note, { color: BRAND }]}>No movement this week — no approved progress, man-hours or deliveries were recorded for this project.</Text>
      )}

      <Text style={styles.sectionTitle}>Cost performance</Text>
      <View style={styles.tileRow}>
        <Tile label="Contract value" value={bhd0(m.contractValue)} />
        <Tile label="BAC" value={bhd0(m.bac)} />
        <Tile label="EV" value={bhd0(m.ev)} sub="earned value" />
        <Tile label="AC" value={bhd0(m.ac)} sub="approved field cost" />
        <Tile label="CV" value={bhd0(m.cv)} sub="EV − AC" />
        <Tile label="CPI" value={idx(m.cpi)} sub={m.cpi == null ? 'no cost yet' : m.cpi < 1 ? 'over budget' : 'on/under budget'} />
        <Tile label="EAC" value={bhd0(m.eac)} sub="estimate at completion" />
        <Tile label="VAC" value={bhd0(m.vac)} sub="budget − EAC" />
      </View>

      <Text style={styles.sectionTitle}>Progress</Text>
      <View style={styles.tileRow}>
        <Tile label="Physical % complete" value={pct1(page.physicalPercent)} sub="weighted progress" />
        <Tile label="Value % complete" value={pct1(page.valuePercent)} sub="EV ÷ BAC" />
        <Tile label="Movement this week" value={signed(page.movement)} sub="physical %, this week" />
        <Tile label="Man-hours (week)" value={`${page.manHoursWeek}`} sub={`cumulative ${page.manHoursCumulative}`} />
        <Tile label="Deliveries (week)" value={`${page.deliveriesWeek}`} sub="received this week" />
        <Tile label="Certified to date" value={bhd0(page.certifiedToDate)} sub={`outstanding ${bhd0(page.outstandingReceivables)}`} />
        <Tile label="Open alerts" value={`${page.openAlerts}`} sub="inventory alerts" />
      </View>

      <Text style={styles.sectionTitle}>Activity matrix</Text>
      <Text style={[styles.muted, styles.note, { fontSize: 7.5, marginBottom: 4 }]}>Cells are cumulative % complete; a shaded cell with a +value moved in the last 7 days.</Text>
      {page.matrix.length === 0 ? (
        <Text style={styles.muted}>No active activities.</Text>
      ) : (
        page.matrix.map((activity) => <MatrixTable key={activity.key} activity={activity} />)
      )}

      <Footer data={data} />
    </Page>
  )
}

export function WeeklySummaryPdf({ data }: { data: WeeklySummaryData }) {
  return (
    <Document title={`Weekly Summary ${data.week.startStr}`}>
      <PortfolioPage data={data} />
      {data.projects.map((page) => <ProjectPage key={page.id} page={page} data={data} />)}
    </Document>
  )
}

import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { PdfHeader } from '@/lib/pdf/PdfHeader'

/**
 * Material-request "letter" — a procurement hand-off document. QUANTITIES ONLY: it shows the
 * APPROVED quantity per material and carries NO cost, rate, or BHD anywhere. The supervisor
 * prints and handles this, so the money wall holds inside the document too — this data shape
 * has no cost field by construction. Mirrors the daily-report PDF branding/machinery.
 */

export interface MrPdfLine {
  materialName: string
  approvedQty: number
  unit: string
}
export interface MaterialRequestPdfData {
  requestCode: string
  statusLabel: string // "Approved" | "Partially Approved"
  scope: { project: string; asset: string | null; activity: string | null }
  requestedBy: string
  reviewedBy: string | null
  reviewedAt: string | null // pre-formatted date + time (APP_TIMEZONE)
  reviewNote: string | null
  lines: MrPdfLine[] // approved lines only (approvedQty > 0)
  generatedAt: string
}

const BRAND_TEXT = '#47715B' // headings — darker green for AA as small text on white

const styles = StyleSheet.create({
  page: { paddingHorizontal: 40, paddingVertical: 36, fontFamily: 'Inter', fontSize: 10, color: '#1A1917' },
  metaBox: { borderWidth: 1, borderColor: '#E4E3E0', borderRadius: 6, padding: 10, marginBottom: 16 },
  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 90, color: '#5A5852' },
  metaValue: { flex: 1, fontWeight: 600 },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: BRAND_TEXT, marginTop: 10, marginBottom: 6 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#D2D1CC', paddingBottom: 3, marginBottom: 2 },
  th: { fontSize: 8, color: '#7C7A73', textTransform: 'uppercase' },
  row: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#F1F1EF' },
  muted: { color: '#7C7A73' },
  notes: { marginTop: 4, lineHeight: 1.4 },
  // Electronic-approval statement — a printed authorisation, NOT a blank line to sign (no rule above).
  approvalBlock: { marginTop: 28 },
  approvalStatement: { fontSize: 10, fontWeight: 600, color: '#1A1917' },
  approvalTimestamp: { fontSize: 9, color: '#5A5852', marginTop: 2 },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  signBox: { width: '45%' },
  signLine: { borderTopWidth: 1, borderTopColor: '#A8A6A0', marginTop: 28, paddingTop: 4, fontSize: 9, color: '#5A5852' },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#A8A6A0' },
})

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function MaterialRequestPdf({ data }: { data: MaterialRequestPdfData }) {
  const scopeLine = [data.scope.project, data.scope.asset, data.scope.activity].filter(Boolean).join(' · ')
  return (
    <Document title={`Material Request ${data.requestCode}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Material Request" />

        <View style={styles.metaBox}>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Scope</Text><Text style={styles.metaValue}>{scopeLine}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Request</Text><Text style={styles.metaValue}>{data.requestCode} · {data.generatedAt}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Requested by</Text><Text style={styles.metaValue}>{data.requestedBy}</Text></View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Reviewed by</Text>
            <Text style={styles.metaValue}>{data.reviewedBy ?? '—'}{data.reviewedAt ? ` · ${data.reviewedAt}` : ''}</Text>
          </View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Status</Text><Text style={styles.metaValue}>{data.statusLabel}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Approved materials</Text>
        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1 }]}>Material</Text>
          <Text style={[styles.th, { width: 120, textAlign: 'right' }]}>Approved quantity</Text>
        </View>
        {data.lines.length === 0 ? (
          <Text style={styles.muted}>No approved materials.</Text>
        ) : (
          data.lines.map((l, i) => (
            <View key={i} style={styles.row}>
              <Text style={{ flex: 1 }}>{l.materialName}</Text>
              <Text style={{ width: 120, textAlign: 'right' }}>{round3(l.approvedQty)} {l.unit}</Text>
            </View>
          ))
        )}

        {data.reviewNote ? (
          <>
            <Text style={styles.sectionTitle}>Review note</Text>
            <Text style={styles.notes}>{data.reviewNote}</Text>
          </>
        ) : null}

        {data.reviewedBy ? (
          <View style={styles.approvalBlock}>
            <Text style={styles.approvalStatement}>Approved electronically by {data.reviewedBy}</Text>
            {data.reviewedAt ? <Text style={styles.approvalTimestamp}>{data.reviewedAt}</Text> : null}
          </View>
        ) : null}

        <View style={styles.signRow}>
          <View style={styles.signBox}><Text style={styles.signLine}>Issued by (site)</Text></View>
          <View style={styles.signBox}><Text style={styles.signLine}>Received by (procurement)</Text></View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Eversystems Management · {data.requestCode}</Text>
          <Text>Generated {data.generatedAt}</Text>
        </View>
      </Page>
    </Document>
  )
}

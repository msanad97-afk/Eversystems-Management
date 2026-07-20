import React from 'react'
import { Document, Page, View, Text, StyleSheet, Svg, Rect, Path } from '@react-pdf/renderer'

export interface PdfManpower { categoryName: string; headcount: number; hours: number }
export interface PdfMaterial { materialName: string; unit: string; quantity: number }
export interface PdfSub {
  name: string
  isImplicit: boolean
  type: 'MEASURED' | 'LUMPSUM'
  unit: string
  quantityDone: number | null
  percentComplete: number | null
  cumulativePercent: number
  earnedBhd: number | null
  note: string | null
  manpower: PdfManpower[]
  materials: PdfMaterial[]
}
export interface PdfActivity {
  assetName: string
  activityName: string
  ref: string | null
  subs: PdfSub[]
}
export interface ReportPdfData {
  reportCode: string
  reportDate: string
  status: string
  weather: string | null
  generalNotes: string | null
  project: { name: string; projectCode: string; location: string | null }
  author: { name: string }
  activities: PdfActivity[]
  totals: { workers: number; manHours: number }
  generatedAt: string
}

// The app is English-only: all report text is left-to-right Latin, rendered with Inter.

const RED = '#C42217'
const styles = StyleSheet.create({
  page: { paddingHorizontal: 40, paddingVertical: 36, fontFamily: 'Inter', fontSize: 10, color: '#1A1917' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandName: { fontSize: 14, fontWeight: 600 },
  brandSub: { fontSize: 9, color: '#5A5852' },
  title: { fontSize: 16, fontWeight: 600, color: RED },
  metaBox: { borderWidth: 1, borderColor: '#E4E3E0', borderRadius: 6, padding: 10, marginBottom: 16 },
  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 90, color: '#5A5852' },
  metaValue: { flex: 1, fontWeight: 600 },
  assetTitle: { fontSize: 11, fontWeight: 600, color: RED, marginTop: 10, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: '#E4E3E0', paddingBottom: 3 },
  activityBox: { marginBottom: 8, paddingLeft: 4 },
  activityHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  activityName: { fontWeight: 600 },
  row: { flexDirection: 'row', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#F1F1EF' },
  subLabel: { fontSize: 8, color: '#7C7A73', textTransform: 'uppercase', marginTop: 3 },
  muted: { color: '#7C7A73' },
  totals: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, fontWeight: 600, borderTopWidth: 1, borderTopColor: '#D2D1CC', paddingTop: 4 },
  notes: { marginTop: 4, lineHeight: 1.4 },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: RED, marginTop: 10, marginBottom: 6 },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 30 },
  signBox: { width: '45%' },
  signLine: { borderTopWidth: 1, borderTopColor: '#A8A6A0', marginTop: 28, paddingTop: 4, fontSize: 9, color: '#5A5852' },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#A8A6A0' },
})

function CrossMark() {
  return (
    <Svg width={26} height={26} viewBox="0 0 40 40">
      <Rect x={0} y={0} width={40} height={40} rx={9} fill={RED} />
      <Path d="M17 8h6v9h9v6h-9v9h-6v-9H8v-6h9V8z" fill="#FFFFFF" />
    </Svg>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function ReportPdf({ data }: { data: ReportPdfData }) {
  const dateLabel = new Date(`${data.reportDate}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })

  // Group activities by asset (first-seen order).
  const groups: { assetName: string; activities: PdfActivity[] }[] = []
  for (const a of data.activities) {
    let g = groups.find((x) => x.assetName === a.assetName)
    if (!g) { g = { assetName: a.assetName, activities: [] }; groups.push(g) }
    g.activities.push(a)
  }

  return (
    <Document title={`Daily Report ${data.reportCode}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <CrossMark />
            <View>
              <Text style={styles.brandName}>Eversystems</Text>
              <Text style={styles.brandSub}>Management</Text>
            </View>
          </View>
          <Text style={styles.title}>Daily Report</Text>
        </View>

        <View style={styles.metaBox}>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Project</Text><Text style={styles.metaValue}>{data.project.name}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Code / Date</Text><Text style={styles.metaValue}>{data.project.projectCode} · {data.reportCode} · {dateLabel}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Author</Text><Text style={styles.metaValue}>{data.author.name}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Status / Weather</Text><Text style={styles.metaValue}>{data.status}{data.weather ? ` · ${data.weather}` : ''}</Text></View>
        </View>

        {groups.length === 0 ? (
          <Text style={styles.muted}>No activities recorded.</Text>
        ) : (
          groups.map((g, gi) => (
            <View key={gi} wrap={false}>
              <Text style={styles.assetTitle}>{g.assetName}</Text>
              {g.activities.map((a, ai) => (
                <View key={ai} style={styles.activityBox}>
                  <Text style={styles.activityName}>{a.ref ? `${a.ref} · ` : ''}{a.activityName}</Text>
                  {a.subs.map((s, si) => (
                    <View key={si} style={{ marginTop: 3, paddingLeft: s.isImplicit ? 0 : 6 }}>
                      <View style={styles.activityHead}>
                        <Text style={s.isImplicit ? styles.muted : { fontWeight: 600 }}>{s.isImplicit ? 'Progress' : s.name}</Text>
                        <Text>
                          {s.type === 'LUMPSUM'
                            ? `${round1(s.percentComplete ?? 0)}% complete${s.earnedBhd != null ? ` · earned BHD ${s.earnedBhd}` : ''}`
                            : `${s.quantityDone ?? 0} ${s.unit} · ${round1(s.cumulativePercent)}% complete`}
                        </Text>
                      </View>
                      {s.note ? <Text style={styles.muted}>{s.note}</Text> : null}
                      {s.manpower.length > 0 && (
                        <>
                          <Text style={styles.subLabel}>Manpower</Text>
                          {s.manpower.map((m, mi) => (
                            <View key={mi} style={styles.row}>
                              <Text style={{ flex: 1 }}>{m.categoryName}</Text>
                              <Text style={{ width: 140, textAlign: 'right' }}>{m.headcount} × {m.hours}h = {round1(m.headcount * m.hours)} man-hrs</Text>
                            </View>
                          ))}
                        </>
                      )}
                      {s.materials.length > 0 && (
                        <>
                          <Text style={styles.subLabel}>Materials</Text>
                          {s.materials.map((m, mi) => (
                            <View key={mi} style={styles.row}>
                              <Text style={{ flex: 1 }}>{m.materialName}</Text>
                              <Text style={{ width: 100, textAlign: 'right' }}>{m.quantity} {m.unit}</Text>
                            </View>
                          ))}
                        </>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))
        )}

        <View style={styles.totals}>
          <Text>Total: {data.totals.workers} workers · {data.totals.manHours} man-hours</Text>
        </View>

        {data.generalNotes ? (
          <>
            <Text style={styles.sectionTitle}>General Notes</Text>
            <Text style={styles.notes}>{data.generalNotes}</Text>
          </>
        ) : null}

        <View style={styles.signRow}>
          <View style={styles.signBox}><Text style={styles.signLine}>Prepared by — {data.author.name}</Text></View>
          <View style={styles.signBox}><Text style={styles.signLine}>Reviewed by</Text></View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Eversystems Management</Text>
          <Text>Generated {data.generatedAt}</Text>
        </View>
      </Page>
    </Document>
  )
}

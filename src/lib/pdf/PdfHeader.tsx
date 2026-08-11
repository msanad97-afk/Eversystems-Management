import React from 'react'
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { EVERSYSTEMS_LOGO_PNG_BASE64 } from '@/lib/pdf/logoData'

/**
 * Shared PDF header used by every document: the Eversystems logo on the left (the logo already
 * contains the wordmark, so there is no separate "Eversystems / Management" text) and the
 * document title on the right. The logo is embedded base64 (logoData.ts) — nothing is read from
 * disk at runtime, which is what keeps PDF generation working on Vercel's serverless runtime.
 */
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  logo: { width: 130, height: 28 }, // 4.64:1 — the logo's native aspect ratio, so it is not stretched
  title: { fontSize: 16, fontWeight: 600, color: '#47715B' },
})

export function PdfHeader({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      {/* react-pdf's <Image> is not an HTML <img> and has no alt prop. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={`data:image/png;base64,${EVERSYSTEMS_LOGO_PNG_BASE64}`} style={styles.logo} />
      <Text style={styles.title}>{title}</Text>
    </View>
  )
}

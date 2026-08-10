import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { registerPdfFonts } from '@/lib/pdf/fonts'
import { ReportPdf, type ReportPdfData } from '@/lib/pdf/ReportPdf'
import { MaterialRequestPdf, type MaterialRequestPdfData } from '@/lib/pdf/MaterialRequestPdf'

/**
 * Renders a daily-report PDF to a Buffer. Centralises the one type-cast needed because
 * ReportPdf is a component that returns a <Document>, while renderToBuffer's signature
 * wants a Document element directly.
 */
export async function renderReportPdf(data: ReportPdfData): Promise<Buffer> {
  registerPdfFonts()
  const element = React.createElement(ReportPdf, { data }) as unknown as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}

/** Renders a material-request letter (quantities only) to a Buffer — same fonts/machinery. */
export async function renderMaterialRequestPdf(data: MaterialRequestPdfData): Promise<Buffer> {
  registerPdfFonts()
  const element = React.createElement(MaterialRequestPdf, { data }) as unknown as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}

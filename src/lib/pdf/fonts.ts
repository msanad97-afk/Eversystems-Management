import { Font } from '@react-pdf/renderer'
import { INTER_400_WOFF_BASE64, INTER_600_WOFF_BASE64 } from '@/lib/pdf/interFontData'

/**
 * Registers PDF fonts once per process. The app is English-only, so a single Latin family
 * (Inter) is used throughout. The font bytes are embedded as base64 data URIs (see
 * interFontData.ts) — no disk or bundle-path access at runtime — so PDF generation works on
 * Vercel's serverless runtime, where the woff files were never bundled into the function.
 */

let registered = false

export function registerPdfFonts(): void {
  if (registered) return

  Font.register({
    family: 'Inter',
    fonts: [
      { src: `data:font/woff;base64,${INTER_400_WOFF_BASE64}`, fontWeight: 400 },
      { src: `data:font/woff;base64,${INTER_600_WOFF_BASE64}`, fontWeight: 600 },
    ],
  })

  // Don't hyphenate — keeps codes and words intact.
  Font.registerHyphenationCallback((word) => [word])

  registered = true
}

import fs from 'fs'
import path from 'path'
import { Font } from '@react-pdf/renderer'

/**
 * Registers PDF fonts once per process. The app is English-only, so a single Latin
 * family (Inter) is used throughout. The font is embedded as a data URI at
 * registration time so PDF generation never depends on runtime filesystem access.
 */

let registered = false

function dataUri(pkg: string, file: string): string {
  const full = path.join(process.cwd(), 'node_modules', pkg, 'files', file)
  const buf = fs.readFileSync(full)
  return `data:font/woff;base64,${buf.toString('base64')}`
}

export function registerPdfFonts(): void {
  if (registered) return

  Font.register({
    family: 'Inter',
    fonts: [
      { src: dataUri('@fontsource/inter', 'inter-latin-400-normal.woff'), fontWeight: 400 },
      { src: dataUri('@fontsource/inter', 'inter-latin-600-normal.woff'), fontWeight: 600 },
    ],
  })

  // Don't hyphenate — keeps codes and words intact.
  Font.registerHyphenationCallback((word) => [word])

  registered = true
}

import type { Config } from 'tailwindcss'
import { brand, neutral, status, radii } from './src/lib/theme'

/**
 * Tailwind maps semantic class names onto the design tokens in src/lib/theme.ts.
 * Components use classes like `bg-primary` / `text-fg-muted`; the actual colour
 * lives in one place. Fonts resolve through CSS variables set in the root layout.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: brand.primary,
          ...brand.primaryHex,
        },
        neutral,
        // Semantic surface / foreground aliases
        surface: {
          DEFAULT: neutral[0],
          subtle: neutral[50],
          muted: neutral[100],
        },
        border: {
          DEFAULT: neutral[200],
          strong: neutral[300],
        },
        fg: {
          DEFAULT: neutral[900],
          muted: neutral[600],
          subtle: neutral[500],
          inverted: neutral[0],
        },
        success: { DEFAULT: status.success, bg: status.successBg },
        warning: { DEFAULT: status.warning, bg: status.warningBg },
        danger: { DEFAULT: status.danger, bg: status.dangerBg },
        info: { DEFAULT: status.info, bg: status.infoBg },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: radii.sm,
        md: radii.md,
        lg: radii.lg,
        xl: radii.xl,
      },
    },
  },
  plugins: [],
}

export default config

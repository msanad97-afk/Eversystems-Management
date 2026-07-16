/**
 * Design tokens — single source of truth for the Eversystems Management brand.
 *
 * Inherited (per spec) from the Binaa PMIS theme system: Inter + JetBrains Mono,
 * #C42217 primary. No colour, radius, or font is hardcoded in components — every
 * value flows from here into Tailwind (tailwind.config.ts) and CSS variables
 * (globals.css). Change a value here and it changes everywhere.
 */

export const brand = {
  /** Primary brand red — the cross Logo colour. */
  primary: '#C42217',
  primaryHex: {
    50: '#FCEBEA',
    100: '#F8D0CD',
    200: '#F0A29C',
    300: '#E7736A',
    400: '#DE4539',
    500: '#C42217', // brand
    600: '#A61B12',
    700: '#82150E',
    800: '#5E0F0A',
    900: '#3B0906',
  },
} as const

/** Neutral greys for surfaces, borders, and text. */
export const neutral = {
  0: '#FFFFFF',
  50: '#F8F8F7',
  100: '#F1F1EF',
  200: '#E4E3E0',
  300: '#D2D1CC',
  400: '#A8A6A0',
  500: '#7C7A73',
  600: '#5A5852',
  700: '#403F3A',
  800: '#2A2926',
  900: '#1A1917',
} as const

/** Semantic status colours (badges, alerts, traffic lights later). */
export const status = {
  success: '#1E874B',
  successBg: '#E7F4EC',
  warning: '#B8860B',
  warningBg: '#FBF3E0',
  danger: '#C42217',
  dangerBg: '#FCEBEA',
  info: '#2563A8',
  infoBg: '#E7EFF8',
} as const

export const fonts = {
  sans: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  mono: 'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace',
} as const

export const radii = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  full: '9999px',
} as const

export const theme = { brand, neutral, status, fonts, radii } as const
export type Theme = typeof theme

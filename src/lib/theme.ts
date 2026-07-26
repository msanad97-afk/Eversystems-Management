/**
 * Design tokens — single source of truth for the Eversystems Management brand.
 *
 * Inter + JetBrains Mono, Eversystems green #598C71 primary (sampled from the
 * official ES logo). No colour, radius, or font is hardcoded in components —
 * every value flows from here into Tailwind (tailwind.config.ts) and CSS
 * variables (globals.css). Change a value here and it changes everywhere.
 */

export const brand = {
  /** Primary brand green — sampled from the official Eversystems logo. */
  primary: '#598C71',
  primaryHex: {
    50: '#EAF1ED', // tint: badge bg, selected rows, subtle fills
    100: '#D6E3DB',
    200: '#B3CBBE',
    300: '#8FB3A0', // disabled fill
    400: '#6E9A82',
    500: '#598C71', // brand
    600: '#47715B', // hover / pressed
    700: '#3A5C4A', // small green text / active-nav / badge text (AA on white + tint)
    800: '#2C4638',
    900: '#1F3227',
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

/**
 * Semantic status colours (badges, alerts, traffic lights). Unchanged by the
 * brand rebrand and kept visually distinct from the brand green. `dangerStrong`
 * / `dangerSoft` are the hover / disabled shades for red (danger) buttons — they
 * live in the danger scale, not the brand ramp, so recolouring the brand never
 * turns a danger control green.
 */
export const status = {
  success: '#1E874B',
  successBg: '#E7F4EC',
  warning: '#B8860B',
  warningBg: '#FBF3E0',
  danger: '#C42217',
  dangerBg: '#FCEBEA',
  dangerStrong: '#82150E', // danger button hover / pressed
  dangerSoft: '#E7736A', // danger button disabled
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

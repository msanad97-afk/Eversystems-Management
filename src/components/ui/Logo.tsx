/**
 * Eversystems cross Logo — inherited geometry from the Binaa PMIS mark (a red tile
 * with a white cross), re-lettered for Eversystems. Colour comes from the theme
 * `primary` token; `inverted` renders white-on-transparent for use on the red panel.
 */
export function Logo({
  size = 32,
  withWordmark = false,
  inverted = false,
}: {
  size?: number
  withWordmark?: boolean
  inverted?: boolean
}) {
  const tile = inverted ? '#FFFFFF' : undefined // fall back to CSS token via className when not inverted
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        role="img"
        aria-label="Eversystems"
        className={inverted ? 'text-white' : 'text-primary'}
      >
        {/* Rounded tile */}
        <rect x="0" y="0" width="40" height="40" rx="9" fill={tile ?? 'currentColor'} />
        {/* White cross (negative space) */}
        <path
          d="M17 8h6v9h9v6h-9v9h-6v-9H8v-6h9V8z"
          fill={inverted ? '#C42217' : '#FFFFFF'}
        />
      </svg>
      {withWordmark && (
        <span className="flex flex-col leading-none">
          <span
            className={`text-base font-semibold tracking-tight ${inverted ? 'text-white' : 'text-fg'}`}
          >
            Eversystems
          </span>
          <span
            className={`text-[11px] font-medium ${inverted ? 'text-white/80' : 'text-fg-subtle'}`}
          >
            Management
          </span>
        </span>
      )}
    </span>
  )
}

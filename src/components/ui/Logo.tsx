/* eslint-disable @next/next/no-img-element */
/**
 * Eversystems wordmark. Renders the official horizontal logo (which already
 * includes the mark + wordmark), picking the variant by background:
 *   - `inverted` → white knockout, for the dark/green brand panel
 *   - default    → green logo, for light surfaces (topbar, login card)
 * Constrained by height; width follows to preserve the ~4.6:1 aspect ratio.
 * `withWordmark` is retained for API compatibility (the raster logo always
 * carries the wordmark).
 */
export function Logo({
  size = 32,
  withWordmark: _withWordmark = false,
  inverted = false,
}: {
  size?: number
  withWordmark?: boolean
  inverted?: boolean
}) {
  const src = inverted ? '/logo-horizontal-white.png' : '/logo-horizontal.png'
  return (
    <img
      src={src}
      alt="Eversystems Management"
      height={size}
      style={{ height: size, width: 'auto' }}
      className="inline-block select-none"
      draggable={false}
    />
  )
}

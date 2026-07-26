import type { MetadataRoute } from 'next'

/**
 * PWA / install manifest. Icons use the square Eversystems mark; theme colour is
 * the brand green (already the app's primary token). Next serves this at
 * /manifest.webmanifest and links it from <head> automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Eversystems Management',
    short_name: 'Eversystems',
    description: 'Daily site reporting & management suite',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#598C71',
    icons: [
      { src: '/mark-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/mark-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/mark-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

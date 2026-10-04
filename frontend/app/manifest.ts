import type { MetadataRoute } from 'next'

// Required for `output: 'export'` (Capacitor static bundle).
export const dynamic = 'force-static'

/**
 * Web App Manifest — makes the dashboard installable on phones/tablets.
 * Visit the site once, then "Add to Home Screen" / "Install app" from the
 * browser menu: it launches standalone, black-themed, full screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CareNet IoT — Patient Monitoring Mesh',
    short_name: 'CareNet',
    description:
      'Real-time multi-patient monitoring mesh dashboard: live vitals, risk states, alerts, and network health. Educational prototype — simulated, non-clinical data.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#050505',
    theme_color: '#050505',
    categories: ['medical', 'productivity'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  }
}

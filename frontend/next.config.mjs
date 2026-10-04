/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // For the Capacitor Android app we emit a fully static bundle into `out/`,
  // which `npx cap sync` copies into the app's assets. Server-side features
  // (API routes, SSR) aren't used by the dashboard, so a static export is safe.
  // Dev builds leave this off so `next dev` hot-reload keeps working.
  ...(process.env.CAPACITOR_BUILD === 'true' ? { output: 'export' } : {}),
}

export default nextConfig

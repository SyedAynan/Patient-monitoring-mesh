import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the Next.js dashboard in a native Android WebView.
 *
 * The backend runs on a PC (FastAPI + the simulator mesh). Because the phone
 * can't reach `127.0.0.1` (that's the phone itself), we point the WebView at
 * the live dev/prod server URL rather than bundling a static export. Set the
 * machine's LAN IP in `server.url`, or rely on the in-app backend host
 * override (Settings) which works against a static export too.
 *
 * Two modes are supported:
 *   A) server.url  -> WebView loads the live Next.js server over the LAN.
 *      Simplest for development; hot-reload even works.
 *   B) webDir      -> a `next build && next export` static bundle is copied in.
 *      The app then resolves the backend host at runtime (Settings screen).
 *
 * Mode A is used by default via CAPACITOR_SERVER_URL env var so nothing is
 * hard-coded to a developer's LAN IP.
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.rempm.mesh',
  appName: 'CareNet Mesh',
  // Static export output when using mode B. `next build` + `next export`
  // writes to `out/`; cap sync copies it into the Android assets.
  webDir: 'out',
  server: serverUrl
    ? {
        url: serverUrl,
        // LAN backend is plain HTTP on a private network; allow it.
        cleartext: true,
      }
    : {
        // Bundled mode: keep cleartext so the runtime-configured LAN backend
        // (plain http://) is reachable from the WebView fetch/WebSocket.
        cleartext: true,
      },
  android: {
    // Let the WebView reach http:// backends over the LAN.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#050505',
      showSpinner: false,
    },
  },
};

export default config;

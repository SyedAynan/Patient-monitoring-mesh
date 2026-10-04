/**
 * Runtime backend-host resolution for the Android (Capacitor) build and the
 * browser build alike.
 *
 * Why this exists: in a packaged APK the dashboard runs inside a WebView on
 * the phone, so `127.0.0.1` would mean the phone itself — not the machine
 * running the FastAPI backend + simulator. The app therefore resolves the
 * backend host at runtime, in this order:
 *
 *   1. A host the user typed into the in-app backend settings and saved to
 *      `localStorage` (runtime override, works without a rebuild).
 *   2. The `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_BACKEND_HOST` baked in at
 *      build time (the normal web/dev path).
 *   3. `127.0.0.1` — correct only for a browser on the same machine as the
 *      backend, or an emulator pointed at the host via `adb reverse`.
 *
 * The native check uses `Capacitor.isNativePlatform()` when the bridge is
 * present and falls back to the `capacitor://` / `https://localhost` scheme the
 * Android WebView uses, so it also works before the Capacitor JS bridge loads.
 */

export const BACKEND_HOST_STORAGE_KEY = 'rempm.backend.host';
export const BACKEND_PORT_STORAGE_KEY = 'rempm.backend.port';

const DEFAULT_BACKEND_PORT = '8000';

/** True when running inside the Capacitor Android/iOS WebView. */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // The Capacitor runtime injects a global; use it if present.
  const cap = (window as any).Capacitor;
  if (cap && typeof cap.isNativePlatform === 'function') {
    try {
      return cap.isNativePlatform();
    } catch {
      /* fall through to scheme check */
    }
  }
  const proto = window.location?.protocol || '';
  const host = window.location?.hostname || '';
  // Capacitor's Android WebView serves the bundle from `https://localhost`
  // (and iOS from `capacitor://`). Treat any localhost-served origin that is
  // NOT a real browser page as native: a real browser on `localhost` reaches
  // the dev server, which we can't distinguish by origin alone — but in that
  // case there is no Capacitor bridge, and we already returned false above.
  // So reaching here means the global is absent AND we're on a native scheme.
  if (proto === 'capacitor:' || proto === 'ionic:') return true;
  if ((proto === 'https:' || proto === 'http:') && host === 'localhost') {
    // Served from the app's own WebView scheme rather than the dev server.
    // `window.Capacitor` may not be defined yet if this runs pre-bridge, but
    // a packaged app has no other reason to be on https://localhost.
    return true;
  }
  return false;
}

/** Read a persisted override from localStorage (native app runtime config). */
function storedValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Strip a scheme and any trailing slash/port-only mistakes the user may type. */
function normalizeHost(input: string): string {
  let h = input.trim();
  h = h.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ''); // drop scheme
  h = h.replace(/\/.*$/, ''); // drop any path
  return h;
}

/**
 * Resolve the backend base HTTP origin (scheme + host + port, no path).
 *
 * Precedence:
 *   native app  -> saved host override, else build-time host, else 127.0.0.1
 *   browser     -> build-time NEXT_PUBLIC_API_URL / host, else 127.0.0.1
 */
export function resolveBackendBaseUrl(): string {
  const buildUrl = process.env.NEXT_PUBLIC_API_URL; // e.g. http://192.168.1.10:8000
  const buildHost = process.env.NEXT_PUBLIC_BACKEND_HOST; // e.g. 192.168.1.10

  // Browser build: honour the full URL env first, then host, then localhost.
  if (!isNativeApp()) {
    if (buildUrl) return buildUrl.replace(/\/$/, '');
    if (buildHost) return `http://${normalizeHost(buildHost)}:${DEFAULT_BACKEND_PORT}`;
    return 'http://127.0.0.1:8000';
  }

  // Native app: runtime-saved host wins so the APK needn't be rebuilt to point
  // at a different machine.
  const savedHost = storedValue(BACKEND_HOST_STORAGE_KEY);
  const savedPort = storedValue(BACKEND_PORT_STORAGE_KEY) || DEFAULT_BACKEND_PORT;
  if (savedHost) {
    const h = normalizeHost(savedHost);
    // Allow a saved value that already carries a port.
    if (h.includes(':')) return `http://${h}`;
    return `http://${h}:${savedPort}`;
  }

  if (buildUrl) return buildUrl.replace(/\/$/, '');
  if (buildHost) return `http://${normalizeHost(buildHost)}:${DEFAULT_BACKEND_PORT}`;

  // Last resort for the app: emulator loopback. adb reverse tcp:8000 maps this
  // to the dev machine; on a physical device the user must set the host.
  return 'http://127.0.0.1:8000';
}

/** Resolve the realtime WebSocket URL from the same base as the HTTP API. */
export function resolveRealtimeWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (!isNativeApp() && explicit) return explicit;
  const base = resolveBackendBaseUrl();
  const wsBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${wsBase}/api/v1/realtime`;
}

/**
 * Persist a runtime backend host (and optional port) chosen in the app UI.
 * Pass an empty host to clear the override.
 */
export function saveBackendHost(host: string, port?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (host && host.trim()) {
      window.localStorage.setItem(BACKEND_HOST_STORAGE_KEY, normalizeHost(host));
      if (port && port.trim()) {
        window.localStorage.setItem(BACKEND_PORT_STORAGE_KEY, port.trim());
      } else {
        window.localStorage.removeItem(BACKEND_PORT_STORAGE_KEY);
      }
    } else {
      window.localStorage.removeItem(BACKEND_HOST_STORAGE_KEY);
      window.localStorage.removeItem(BACKEND_PORT_STORAGE_KEY);
    }
  } catch {
    /* storage unavailable */
  }
}

/** The currently saved override (for pre-filling the settings field). */
export function currentSavedBackendHost(): string {
  return storedValue(BACKEND_HOST_STORAGE_KEY) || '';
}

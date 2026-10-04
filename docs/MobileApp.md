# Mobile App — Android APK

The monitoring dashboard also ships as a **native Android app** built with
[Capacitor](https://capacitorjs.com/). The same Next.js dashboard runs inside a
native WebView, so there is one codebase for browser, PWA, and APK.

> **⚠️ Note:** This is an educational/research prototype. The APK is a debug
> build for local/LAN use, not a Play-Store release and not a medical device.

## One-click download (GitHub Release)

CI builds the APK automatically and attaches it to a release, so phones can
install without any build tools:

**<https://github.com/SyedAynan/Patient-monitoring-mesh/releases/latest/download/carenet-mesh.apk>**

- Open that link on an Android phone → download → install (allow "unknown
  sources" for your browser when prompted).
- The workflow `.github/workflows/release-apk.yml` runs on every version tag
  (`git tag v1.0.0 && git push origin v1.0.0`) and on manual trigger from the
  **Actions** tab; it maintains a rolling `latest` pre-release asset.
- The README has a download badge and a QR code pointing at the same URL.

## How it works

```
┌──────────┐      Wi-Fi / LAN       ┌─────────────────────────┐
│ Android  │  http://PC-IP:8000     │  PC                     │
│ app (APK)│ ─────────────────────▶ │  FastAPI backend        │
│ WebView  │  ws://PC-IP:8000/...   │   + simulator mesh      │
└──────────┘                        └─────────────────────────┘
```

The app is a thin shell around the web dashboard. All live data comes from the
backend over HTTP + WebSocket. **The phone cannot reach `127.0.0.1`** — that is
the phone itself — so the app must be told the PC's LAN IP at runtime.

`lib/capacitor.ts` resolves the backend host in this order:

1. A host you type in **Settings → Backend Server** (saved to the device —
   no rebuild needed).
2. `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_BACKEND_HOST` baked in at build time.
3. `127.0.0.1` — only correct in a browser on the same machine, or on an
   emulator with `adb reverse tcp:8000 tcp:8000`.

## Build the APK

**Prerequisites (one-time):**

- Frontend deps installed — run `INSTALL.bat` / `./install.sh` once.
- **JDK 17+** on PATH (or Android Studio, which bundles one).
- An **Android SDK**. Two ways to get one:
  - *Already have Android Studio?* Nothing to do — the build uses its SDK via
    `ANDROID_HOME`.
  - *No Android Studio?* Run the bundled installer once (downloads ~700 MB into
    `.android-sdk/` at the repo root):

    ```bash
    setup-android-sdk.bat    # Windows
    ./setup-android-sdk.sh   # macOS / Linux
    ```

The build scripts auto-detect the SDK (env var → `local.properties` → the
repo-local `.android-sdk/`) and write `frontend/android/local.properties` for
you.

Then build:

```bash
# Windows
build-apk.bat

# macOS / Linux
./build-apk.sh
```

The script:

1. `npm run build:mobile` — builds the dashboard with `output: 'export'`
   into `frontend/out/`.
2. `npx cap sync android` — copies the bundle into the app's assets.
3. `gradlew assembleDebug` — compiles the APK.

**Output:** `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

## Run it on a phone

1. Start the backend so other devices can reach it (it must listen on
   `0.0.0.0`, not `127.0.0.1`):

   ```bash
   start.bat --lan      # Windows
   ./start.sh --lan     # macOS / Linux
   ```

   Find the PC's LAN IP (`ipconfig` → "IPv4 Address", e.g. `192.168.1.10`).

2. Copy `app-debug.apk` to the phone (USB, or a download link on the LAN) and
   install it. Android may ask to allow installs from that source.

3. Open the app → **Settings** tab → **Backend Server** → enter the PC's IP
   (e.g. `192.168.1.10`) → **Save**. The app reconnects immediately.

4. Phone and PC must be on the **same Wi-Fi network**.

## Emulator

On an Android emulator, `127.0.0.1` won't reach the host PC — use the special
host-loopback address **`10.0.2.2`** in Settings → Backend Server, or run
`adb reverse tcp:8000 tcp:8000` and leave it at `127.0.0.1`.

## Project layout

| Path | Purpose |
|------|---------|
| `frontend/capacitor.config.ts` | Capacitor config (app id, webDir, cleartext) |
| `frontend/lib/capacitor.ts` | Runtime backend-host resolution |
| `frontend/scripts/build-mobile.mjs` | Static-export build helper |
| `frontend/android/` | Generated Android project |
| `frontend/android/.../network_security_config.xml` | Cleartext-HTTP policy for the LAN backend |
| `build-apk.bat` / `build-apk.sh` | One-command build launchers |
| `setup-android-sdk.bat` / `.sh` | Install a local SDK (when Android Studio is absent) |
| `.android-sdk/` | Repo-local SDK (gitignored, created by the setup script) |

## Release build

`build-apk.bat` produces a **debug** APK signed with the debug key (fine for
side-loading on your own devices). For a signed release APK, generate a
keystore, reference it in `android/app/build.gradle`, then run
`./gradlew assembleRelease`. Keep the keystore out of version control — it is
already in `.gitignore`.

## Security note

The backend speaks plain HTTP on the LAN (there is no TLS terminator in this
prototype). `usesCleartextTraffic="true"` is therefore set in the manifest.
This is acceptable for a private lab network; do **not** expose the backend to
an untrusted network without adding TLS and turning cleartext off.

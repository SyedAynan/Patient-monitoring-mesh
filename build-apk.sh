#!/usr/bin/env bash
# CareNet IoT — build the Android APK (macOS / Linux)
# Builds the static web bundle, syncs it into the Android project, and
# compiles a debug APK with the Gradle wrapper.
#
# Prerequisites (one-time):
#   * Android Studio / Android SDK (installs the SDK + build-tools)
#   * JDK 17+ on PATH (Android Studio bundles one)
#   * frontend deps installed (run ./install.sh first)
#
# Output: frontend/android/app/build/outputs/apk/debug/app-debug.apk

set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "=== CareNet Mesh — Build Android APK ==="
echo ""

[ -d frontend/node_modules ] || { echo "[ERROR] Frontend not installed. Run ./install.sh first."; exit 1; }

# ---- Locate the Android SDK ----
# Gradle resolves the SDK via ANDROID_HOME / ANDROID_SDK_ROOT / the sdk.dir line
# in frontend/android/local.properties. Fall back to the repo-local SDK created
# by ./setup-android-sdk.sh.
SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK_DIR" ] && [ -f frontend/android/local.properties ]; then
  SDK_DIR="$(grep '^sdk.dir=' frontend/android/local.properties | cut -d= -f2-)"
fi
if [ -z "$SDK_DIR" ] && [ -d .android-sdk/platforms ]; then
  SDK_DIR="$PWD/.android-sdk"
fi
if [ -z "$SDK_DIR" ]; then
  echo "[ERROR] No Android SDK found."
  echo "  Run ./setup-android-sdk.sh to install a local SDK, or install"
  echo "  Android Studio and set ANDROID_HOME."
  exit 1
fi

echo "Using Android SDK: $SDK_DIR"
echo "sdk.dir=$SDK_DIR" > frontend/android/local.properties
export ANDROID_HOME="$SDK_DIR"

cd frontend

echo "[1/3] Building the web dashboard (static export)..."
npm run build:mobile

echo ""
echo "[2/3] Syncing web bundle into the Android project..."
npx cap sync android

echo ""
echo "[3/3] Compiling the APK with Gradle..."
cd android
./gradlew assembleDebug

echo ""
echo "============================================================"
echo " APK built:"
echo "   frontend/android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo " Install on a device (same Wi-Fi) or run:  ./gradlew installDebug"
echo " Start the backend with  ./start.sh --lan  and enter this PC's"
echo " IP in the app's Settings > Backend Server field."
echo "============================================================"

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

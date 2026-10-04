#!/usr/bin/env bash
# CareNet IoT — install a local Android SDK (macOS / Linux)
# Downloads the Android command-line tools + platform-36 + build-tools into
# .android-sdk/ at the repo root, then points the app at it.
#
# Use this if you do NOT have Android Studio installed. If you do, skip this
# script and just set ANDROID_HOME (or open the android/ folder in Studio).
#
# Download is ~700 MB. Run once. After this, ./build-apk.sh works standalone.

set -euo pipefail
cd "$(dirname "$0")"

SDK_DIR="$PWD/.android-sdk"
case "$(uname -s)" in
  Darwin) TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip" ;;
  *)      TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" ;;
esac
ZIP="$SDK_DIR/cmdtools.zip"

echo ""
echo "=== CareNet Mesh — Android SDK setup ==="
echo "Target: $SDK_DIR"
echo ""

command -v java >/dev/null 2>&1 || { echo "[ERROR] Java not found. Install JDK 17+ (or Android Studio)."; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "[ERROR] curl not found."; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "[ERROR] unzip not found."; exit 1; }

if [ ! -d "$SDK_DIR/platforms/android-36" ]; then
  echo "[1/3] Downloading Android command-line tools..."
  mkdir -p "$SDK_DIR"
  curl -fSL -o "$ZIP" "$TOOLS_URL"

  echo "[2/3] Extracting..."
  unzip -q -o "$ZIP" -d "$SDK_DIR/ct-tmp"
  mkdir -p "$SDK_DIR/cmdline-tools/latest"
  cp -R "$SDK_DIR/ct-tmp/cmdline-tools/." "$SDK_DIR/cmdline-tools/latest/"
  rm -rf "$SDK_DIR/ct-tmp" "$ZIP"

  echo "[3/3] Installing platform-36, build-tools, platform-tools..."
  yes | "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
  "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" \
      "platform-tools" "platforms;android-36" "build-tools;36.0.0"
else
  echo "SDK already present. Refreshing local.properties only."
fi

# Point the Gradle project at this SDK.
echo "sdk.dir=$SDK_DIR" > frontend/android/local.properties

echo ""
echo "============================================================"
echo " SDK ready at $SDK_DIR"
echo " frontend/android/local.properties now points at it."
echo " Run  ./build-apk.sh  to compile the APK."
echo "============================================================"

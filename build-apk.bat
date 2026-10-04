@echo off
REM CareNet IoT — build the Android APK (Windows)
REM Builds the static web bundle, syncs it into the Android project, and
REM compiles a debug APK with the Gradle wrapper.
REM
REM Prerequisites (one-time):
REM   * Android Studio / Android SDK (installs the SDK + build-tools)
REM   * JAVA_HOME or Android Studio's bundled JDK on the PATH
REM   * frontend deps installed (run INSTALL.bat first)
REM
REM Output: frontend\android\app\build\outputs\apk\debug\app-debug.apk

setlocal
cd /d "%~dp0"

echo.
echo === CareNet Mesh - Build Android APK ===
echo.

if not exist frontend\node_modules (
    echo [ERROR] Frontend not installed. Run INSTALL.bat first.
    pause
    exit /b 1
)

cd frontend

echo [1/3] Building the web dashboard (static export)...
call npm run build:mobile
if errorlevel 1 goto :fail

echo.
echo [2/3] Syncing web bundle into the Android project...
call npx cap sync android
if errorlevel 1 goto :fail

echo.
echo [3/3] Compiling the APK with Gradle...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  APK built successfully:
echo    frontend\android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo  Copy it to a phone (same Wi-Fi) and install it, or run:
echo    gradlew.bat installDebug     ^(with a device plugged in^)
echo.
echo  Remember: start the backend with  start.bat --lan  and enter
echo  this PC's IP in the app's Settings ^> Backend Server field.
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed. If the error mentions the Android SDK or licenses,
echo open Android Studio once and accept the SDK licenses, then retry.
echo.
pause
exit /b 1

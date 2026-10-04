@echo off
REM CareNet IoT — install a local Android SDK (Windows)
REM Downloads the Android command-line tools + platform-36 + build-tools into
REM .android-sdk\ at the repo root, then points the app at it.
REM
REM Use this if you do NOT have Android Studio installed. If you do, skip this
REM script and just set ANDROID_HOME (or open the android\ folder in Studio).
REM
REM Download is ~700 MB. Run once. After this, build-apk.bat works standalone.

setlocal
cd /d "%~dp0"

set "SDK_DIR=%CD%\.android-sdk"
set "TOOLS_URL=https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
set "ZIP=%SDK_DIR%\cmdtools.zip"

echo.
echo === CareNet Mesh - Android SDK setup ===
echo Target: %SDK_DIR%
echo.

where java >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Java not found on PATH. Install JDK 17+ (or Android Studio).
    pause
    exit /b 1
)

if exist "%SDK_DIR%\platforms\android-36" (
    echo SDK already present. Refreshing local.properties only.
    goto :configure
)

echo [1/3] Downloading Android command-line tools...
if not exist "%SDK_DIR%" mkdir "%SDK_DIR%"
curl -L -o "%ZIP%" "%TOOLS_URL%"
if errorlevel 1 goto :fail

echo [2/3] Extracting...
powershell -NoProfile -Command "Expand-Archive -Force '%ZIP%' '%SDK_DIR%\ct-tmp'"
mkdir "%SDK_DIR%\cmdline-tools\latest" >nul 2>nul
xcopy /E /I /Y "%SDK_DIR%\ct-tmp\cmdline-tools\*" "%SDK_DIR%\cmdline-tools\latest\" >nul
rmdir /S /Q "%SDK_DIR%\ct-tmp" "%SDK_DIR%\ct-tmp" 2>nul
del "%ZIP%"

echo [3/3] Installing platform-36, build-tools, platform-tools...
REM Accept licenses non-interactively, then install the needed packages.
(echo y& echo y& echo y& echo y& echo y& echo y& echo y& echo y) | "%SDK_DIR%\cmdline-tools\latest\bin\sdkmanager.bat" --licenses >nul
"%SDK_DIR%\cmdline-tools\latest\bin\sdkmanager.bat" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
if errorlevel 1 goto :fail

:configure
REM Point the Gradle project at this SDK.
> frontend\android\local.properties echo sdk.dir=%SDK_DIR:\=/%
echo.
echo ============================================================
echo  SDK ready at %SDK_DIR%
echo  frontend\android\local.properties now points at it.
echo  Run  build-apk.bat  to compile the APK.
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] SDK setup failed. Check your internet connection and Java install,
echo or install Android Studio instead (it manages the SDK for you).
echo.
pause
exit /b 1

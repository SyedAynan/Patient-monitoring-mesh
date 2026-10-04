@echo off
REM CareNet IoT — one-click start (Windows)
REM Starts the backend (port 8000) and the dashboard (port 3000).
REM Run INSTALL.bat once first.
REM
REM   start.bat         backend listens on 127.0.0.1 (this PC only)
REM   start.bat --lan   backend listens on 0.0.0.0 so the Android app on the
REM                     same Wi-Fi network can reach it. Use this for the APK.

setlocal
cd /d "%~dp0"

set "BACKEND_HOST=127.0.0.1"
set "LAN_MODE=0"
if /i "%~1"=="--lan" (
    set "BACKEND_HOST=0.0.0.0"
    set "LAN_MODE=1"
)

if not exist .venv (
    echo [ERROR] Not installed yet. Run INSTALL.bat first.
    pause
    exit /b 1
)
if not exist frontend\node_modules (
    echo [ERROR] Frontend not installed. Run INSTALL.bat first.
    pause
    exit /b 1
)

echo.
echo === CareNet IoT - starting ===
if "%LAN_MODE%"=="1" (
    echo Backend:  http://0.0.0.0:8000   ^(reachable from other devices on this network^)
    echo For the Android app: find this PC's IP below and enter it in the app's
    echo Settings ^> Backend Server field.
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   This PC's IP:%%a
) else (
    echo Backend:  http://127.0.0.1:8000   ^(Ctrl+C in its window to stop^)
)
echo Dashboard: http://localhost:3000
echo.
echo A browser tab will open when the dashboard is ready.
echo.

call .venv\Scripts\activate.bat

REM Backend in its own window:
start "CareNet Backend" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.app.main:create_app --factory --host %BACKEND_HOST% --port 8000"

REM Give the backend a moment before the frontend starts calling it:
timeout /t 3 /nobreak >nul

REM Frontend in its own window, then open the browser:
cd frontend
start "CareNet Dashboard" cmd /k "npm run dev"
timeout /t 8 /nobreak >nul
start http://localhost:3000

echo Both services are starting in their own windows.
echo Close those windows to stop the system.
echo.
pause
exit /b 0

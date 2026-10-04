@echo off
REM CareNet IoT — one-click start (Windows)
REM Starts the backend (port 8000) and the dashboard (port 3000).
REM Run INSTALL.bat once first.

setlocal
cd /d "%~dp0"

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
echo Backend:  http://127.0.0.1:8000   (Ctrl+C in its window to stop)
echo Dashboard: http://localhost:3000
echo.
echo A browser tab will open when the dashboard is ready.
echo.

call .venv\Scripts\activate.bat

REM Backend in its own window:
start "CareNet Backend" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000"

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

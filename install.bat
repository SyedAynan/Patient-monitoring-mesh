@echo off
REM CareNet IoT — one-click install (Windows)
REM Installs the Python backend deps and the frontend deps, then starts both.
REM Run from the repository root. Requires Python 3.10+ and Node 18+.

setlocal
cd /d "%~dp0"

echo.
echo === CareNet IoT - Patient Monitoring Mesh ===
echo Installing. First run takes a few minutes.
echo.

REM ---- Python backend ----
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

if not exist .venv (
    echo [1/3] Creating Python virtual environment...
    python -m venv .venv
    if errorlevel 1 goto :fail
)
call .venv\Scripts\activate.bat

echo [2/3] Installing backend dependencies...
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r backend\requirements.txt
if errorlevel 1 goto :fail

REM ---- Frontend ----
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js / npm not found. Install from https://nodejs.org
    pause
    exit /b 1
)

if not exist frontend\node_modules (
    echo [3/3] Installing frontend dependencies...
    cd frontend
    call npm install
    if errorlevel 1 goto :fail
    cd ..
)

echo.
echo Install complete.
echo.
echo Next: double-click START.bat (or run it in a terminal).
echo The dashboard will open at http://localhost:3000
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Installation failed. See the messages above.
pause
exit /b 1

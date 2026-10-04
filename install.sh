#!/usr/bin/env bash
# CareNet IoT — one-click install (macOS / Linux)
# Installs the Python backend deps and the frontend deps.
# Run from the repository root. Requires Python 3.10+ and Node 18+.

set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "=== CareNet IoT — Patient Monitoring Mesh ==="
echo "Installing. First run takes a few minutes."
echo ""

command -v python3 >/dev/null 2>&1 || { echo "[ERROR] python3 not found. Install Python 3.10+."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[ERROR] npm not found. Install Node.js 18+."; exit 1; }

if [ ! -d .venv ]; then
  echo "[1/3] Creating Python virtual environment..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "[2/3] Installing backend dependencies..."
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r backend/requirements.txt

if [ ! -d frontend/node_modules ]; then
  echo "[3/3] Installing frontend dependencies..."
  (cd frontend && npm install)
fi

echo ""
echo "Install complete."
echo ""
echo "Next: run ./start.sh"
echo "The dashboard will open at http://localhost:3000"
echo ""

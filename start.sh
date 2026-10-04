#!/usr/bin/env bash
# CareNet IoT — one-click start (macOS / Linux)
# Starts the backend (port 8000) and the dashboard (port 3000).
# Run ./install.sh once first.

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ] || [ ! -d frontend/node_modules ]; then
  echo "[ERROR] Not installed yet. Run ./install.sh first."
  exit 1
fi

echo ""
echo "=== CareNet IoT — starting ==="
echo "Backend:   http://127.0.0.1:8000"
echo "Dashboard: http://localhost:3000"
echo ""

# shellcheck disable=SC1091
source .venv/bin/activate

# Backend in the background; frontend in the foreground.
python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT

# Give the backend a moment before the frontend starts calling it:
sleep 3

( cd frontend && npm run dev ) &
FRONTEND_PID=$!
trap 'kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' EXIT

# Open the browser once the dev server is likely up:
sleep 8
( command -v xdg-open >/dev/null && xdg-open http://localhost:3000 ) ||
( command -v open >/dev/null && open http://localhost:3000 ) || true

echo ""
echo "Press Ctrl+C to stop both services."
echo ""
wait

#!/usr/bin/env bash
# CareNet IoT — one-click start (macOS / Linux)
# Starts the backend (port 8000) and the dashboard (port 3000).
# Run ./install.sh once first.

set -euo pipefail
cd "$(dirname "$0")"

BACKEND_HOST=127.0.0.1
LAN_MODE=0
if [ "${1:-}" = "--lan" ]; then
  BACKEND_HOST=0.0.0.0
  LAN_MODE=1
fi

if [ ! -d .venv ] || [ ! -d frontend/node_modules ]; then
  echo "[ERROR] Not installed yet. Run ./install.sh first."
  exit 1
fi

echo ""
echo "=== CareNet IoT — starting ==="
if [ "$LAN_MODE" = "1" ]; then
  echo "Backend:   http://0.0.0.0:8000  (reachable from devices on this network)"
  echo "For the Android app, enter this machine's IP in Settings > Backend Server."
else
  echo "Backend:   http://127.0.0.1:8000"
fi
echo "Dashboard: http://localhost:3000"
echo ""

# shellcheck disable=SC1091
source .venv/bin/activate

# Backend in the background; frontend in the foreground.
python -m uvicorn backend.app.main:create_app --factory --host "$BACKEND_HOST" --port 8000 &
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

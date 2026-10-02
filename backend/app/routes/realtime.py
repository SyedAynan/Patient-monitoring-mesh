"""WebSocket /api/v1/realtime — server-pushed measurement, alert, and event stream."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..simulator_state import state

router = APIRouter()


@router.websocket("/realtime")
async def realtime_ws(ws: WebSocket):
    await ws.accept()
    queue = state.subscribe_ws()
    try:
        while True:
            msg = await queue.get()
            await ws.send_text(json.dumps(msg))
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        state.unsubscribe_ws(queue)

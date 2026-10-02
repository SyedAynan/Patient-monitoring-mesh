"""GET /api/v1/devices — list all devices in the mesh."""

from __future__ import annotations

from fastapi import APIRouter

from ..simulator_state import state, _device_to_dict

router = APIRouter()


@router.get("/devices")
async def list_devices():
    items = [_device_to_dict(d) for d in state.devices.values()]
    return {"data": {"items": items}, "error": None}

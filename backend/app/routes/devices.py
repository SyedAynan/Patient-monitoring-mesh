"""GET /api/v1/devices — list all devices in the mesh.

POST /api/v1/devices/{device_id}/revoke — revoke a device's credentials
(Phase 7). Guarded by the operator-token check in token mode.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from ..security import check_mutation, make_audit_event
from ..simulator_state import state, _device_to_dict

router = APIRouter()


@router.get("/devices")
async def list_devices():
    items = [_device_to_dict(d) for d in state.devices.values()]
    return {"data": {"items": items}, "error": None}


@router.post("/devices/{device_id}/revoke")
async def revoke_device(
    device_id: str,
    x_operator_token: str | None = Header(default=None, alias="X-Operator-Token"),
):
    decision = check_mutation(x_operator_token)
    if not decision.allowed:
        event = make_audit_event(
            action="device_revoke", actor="operator", target=device_id,
            outcome=decision.reason, detail="refused",
        )
        if state.persistence is not None:
            state.persistence.write_audit_event(event.to_dict())
        raise HTTPException(
            status_code=401,
            detail={"code": "AUTH_REFUSED", "message": "operator authentication failed"},
        )

    mesh = state.mesh
    store = mesh.gateway.credential_store if mesh is not None else None
    if store is None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "AUTHENTICATION_DISABLED",
                "message": "the mesh is not running with device authentication",
            },
        )
    if not store.is_known(device_id):
        raise HTTPException(
            status_code=404, detail={"code": "NOT_FOUND", "message": "unknown device"}
        )
    revoked = store.revoke(device_id)
    # Reflect it in the device registry the dashboard sees.
    record = state.devices.get(device_id)
    if record is not None:
        record.status = "offline"

    event = make_audit_event(
        action="device_revoke", actor="operator", target=device_id,
        outcome="OK" if revoked else "ALREADY_REVOKED",
    )
    if state.persistence is not None:
        state.persistence.write_audit_event(event.to_dict())
    return {
        "data": {"device_id": device_id, "revoked": revoked},
        "error": None,
    }

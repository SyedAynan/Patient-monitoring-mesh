"""GET /api/v1/patients/{patient_id}/measurements — measurement history."""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..simulator_state import state, _measurement_to_dict

router = APIRouter()


@router.get("/patients/{patient_id}/measurements")
async def get_measurements(
    patient_id: str,
    from_ms: int | None = Query(None),
    to_ms: int | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    items = []
    for m in state.measurements:
        if m.patient_id != patient_id:
            continue
        if from_ms is not None and m.captured_at_ms < from_ms:
            continue
        if to_ms is not None and m.captured_at_ms > to_ms:
            continue
        items.append(_measurement_to_dict(m))
    # ascending by captured_at_ms, limited
    items.sort(key=lambda x: x["captured_at_ms"])
    items = items[-limit:]
    return {"data": {"items": items}, "error": None}

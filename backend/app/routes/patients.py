"""GET /api/v1/patients/{patient_id}/measurements — measurement history.

History reads come from SQLite when persistence is enabled, so the route serves
everything ever recorded, not just the in-memory deque window. With persistence
disabled (tests), it falls back to the in-memory store.
"""

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
    if state.persistence is not None:
        items = state.persistence.measurements_for(
            patient_id, from_ms=from_ms, to_ms=to_ms, limit=limit
        )
        return {"data": {"items": items}, "error": None}

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

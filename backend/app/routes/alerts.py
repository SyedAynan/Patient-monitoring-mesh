"""Alerts: GET /api/v1/alerts, POST /api/v1/alerts/{alert_id}/acknowledge."""

from __future__ import annotations

import time

from fastapi import APIRouter, Query, HTTPException

from ..simulator_state import state, _alert_to_dict

router = APIRouter()


@router.get("/alerts")
async def list_alerts(
    status: str | None = Query(None, pattern="^(active|acknowledged)$"),
):
    items = []
    for a in state.alerts.values():
        if status == "active" and a.acknowledged_at_ms is not None:
            continue
        if status == "acknowledged" and a.acknowledged_at_ms is None:
            continue
        items.append(_alert_to_dict(a))
    # Most recent first.
    items.sort(key=lambda x: x["raised_at_ms"], reverse=True)
    return {"data": {"items": items}, "error": None}


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    a = state.alerts.get(alert_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    a.acknowledged_at_ms = int(time.time() * 1000)
    a.acknowledged_by = "operator"
    if state.persistence is not None:
        state.persistence.acknowledge_alert(alert_id, a.acknowledged_at_ms, "operator")
    return {"data": _alert_to_dict(a), "error": None}

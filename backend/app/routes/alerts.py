"""Alerts: GET /api/v1/alerts, POST /api/v1/alerts/{alert_id}/acknowledge."""

from __future__ import annotations

import time

from fastapi import APIRouter, Header, HTTPException, Query

from ..security import AuthDecision, check_mutation, make_audit_event
from ..simulator_state import state, _alert_to_dict

router = APIRouter()


def _auth_error(decision: AuthDecision) -> HTTPException:
    """A 401 in the envelope error shape the API contract specifies."""
    code_by_reason = {
        "MISSING_TOKEN": "AUTH_TOKEN_MISSING",
        "WRONG_TOKEN": "AUTH_TOKEN_INVALID",
        "NOT_CONFIGURED": "AUTH_NOT_CONFIGURED",
    }
    return HTTPException(
        status_code=401,
        detail={
            "code": code_by_reason.get(decision.reason, "AUTH_REFUSED"),
            "message": "operator authentication failed",
        },
    )


def _record_audit(*, action: str, target: str, outcome: str, detail: str = "") -> None:
    event = make_audit_event(
        action=action, actor="operator", target=target, outcome=outcome, detail=detail
    )
    if state.persistence is not None:
        state.persistence.write_audit_event(event.to_dict())


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
async def acknowledge_alert(
    alert_id: str,
    x_operator_token: str | None = Header(default=None, alias="X-Operator-Token"),
):
    decision = check_mutation(x_operator_token)
    if not decision.allowed:
        _record_audit(
            action="alert_acknowledge", target=alert_id,
            outcome=decision.reason, detail="refused",
        )
        raise _auth_error(decision)

    a = state.alerts.get(alert_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    a.acknowledged_at_ms = int(time.time() * 1000)
    a.acknowledged_by = "operator"
    if state.persistence is not None:
        state.persistence.acknowledge_alert(alert_id, a.acknowledged_at_ms, "operator")
    _record_audit(
        action="alert_acknowledge", target=alert_id, outcome="OK",
        detail=f"severity={a.severity}",
    )
    return {"data": _alert_to_dict(a), "error": None}

"""Risk endpoints: explanation and configuration.

- GET  /api/v1/patients/{patient_id}/risk — current level, history with evidence
- GET  /api/v1/risk/config — the live rule set (bounds, weights, gates)
- PUT  /api/v1/risk/config — retune the four main thresholds, validated

The PUT also updates every node's risk config in the running mesh, which is the
point of sharing one rule set: the backend is authoritative, and the nodes it
feeds re-score with the same rules immediately. Node and backend cannot drift.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..simulator_state import state, _measurement_to_dict

router = APIRouter()


class RiskConfigUpdate(BaseModel):
    """The four operator-tunable thresholds. All four are required."""

    hr_high: float
    hr_low: float
    spo2_low: float
    temp_high: float


def _thresholds_of(config) -> dict:
    """The four main bounds, by rule name — the operator-facing summary."""
    bounds = {rule.name: rule.bound for rule in config.rules}
    return {
        "hr_high": bounds["hr_high"],
        "hr_low": bounds["hr_low"],
        "spo2_low": bounds["spo2_low"],
        "temp_high": bounds["temp_high"],
    }


def _config_to_dict(config) -> dict:
    return {
        "thresholds": _thresholds_of(config),
        "rules": [
            {
                "name": rule.name,
                "metric": rule.metric,
                "bound": rule.bound,
                "direction": rule.direction,
                "points": rule.points,
            }
            for rule in config.rules
        ],
        "trend_rules": [
            {
                "name": rule.name,
                "metric": rule.metric,
                "per_minute": rule.per_minute,
                "window_seconds": rule.window_seconds,
                "points": rule.points,
            }
            for rule in config.trend_rules
        ],
        "minimum_quality": config.minimum_quality,
        "attention_score": config.attention_score,
        "critical_score": config.critical_score,
    }


@router.get("/patients/{patient_id}/risk")
async def get_patient_risk(
    patient_id: str,
    limit: int = Query(50, ge=1, le=200),
):
    # Current level: the last one broadcast for this patient, if any.
    current_level = state._last_risk_level.get(patient_id)

    # Latest measurement's risk block, from the in-memory store (works with
    # persistence disabled too).
    latest_risk = None
    for measurement in reversed(state.measurements):
        if measurement.patient_id == patient_id:
            latest_risk = measurement.risk
            break

    # History from the database when persistence is enabled.
    history: list[dict] = []
    if state.persistence is not None:
        history = state.persistence.risk_snapshots_for(patient_id, limit=limit)

    return {
        "data": {
            "patient_id": patient_id,
            "level": current_level,
            "latest_packet_risk": latest_risk,
            "history": history,
        },
        "error": None,
    }


@router.get("/risk/config")
async def get_risk_config():
    return {"data": _config_to_dict(state._risk_config), "error": None}


@router.put("/risk/config")
async def put_risk_config(update: RiskConfigUpdate):
    try:
        new_config = state._risk_config.with_thresholds(
            hr_high=update.hr_high,
            hr_low=update.hr_low,
            spo2_low=update.spo2_low,
            temp_high=update.temp_high,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    state._risk_config = new_config
    # Mirror the legacy threshold attributes for backward compatibility.
    thresholds = _thresholds_of(new_config)
    state._hr_high = thresholds["hr_high"]
    state._hr_low = thresholds["hr_low"]
    state._spo2_low = thresholds["spo2_low"]
    state._temp_high = thresholds["temp_high"]

    # Keep the nodes scoring with the same rules — no drift, by construction.
    if state.mesh is not None:
        for node in state.mesh.nodes:
            node.config.risk_config = new_config

    return {"data": _config_to_dict(new_config), "error": None}

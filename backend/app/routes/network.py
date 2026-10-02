"""GET /api/v1/network/metrics — mesh-wide network health."""

from __future__ import annotations

from fastapi import APIRouter

from ..simulator_state import state, _event_to_dict

router = APIRouter()


@router.get("/network/metrics")
async def network_metrics():
    recent = [_event_to_dict(e) for e in list(state.network_events)[-20:]]
    recent.sort(key=lambda x: x["at_ms"], reverse=True)
    return {
        "data": {
            "nodes_total": state.nodes_total,
            "nodes_online": state.nodes_online,
            "delivery_ratio": state.delivery_ratio,
            "alert_latency_ms_p50": state.alert_latency_ms_p50,
            "recent_events": recent,
        },
        "error": None,
    }

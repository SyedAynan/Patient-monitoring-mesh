"""Standard-library implementation of the TelemetryPacketV1 contract.

This module is the single authoritative validator for the wire contract. The
ESP32 firmware, the simulator, the gateway, and the backend must all accept
exactly what `validate_packet` accepts.
"""

from __future__ import annotations

import json
import re
from typing import Any

SCHEMA_VERSION = 1

_DEVICE_ID = re.compile(r"^node-[a-z0-9-]{1,31}$")
_PATIENT_ID = re.compile(r"^patient-[a-z0-9-]{1,31}$")
_PRIORITIES = ("routine", "critical")
_RISK_LEVELS = ("normal", "attention", "critical")

_REQUIRED_FIELDS = (
    "schema_version",
    "packet_type",
    "device_id",
    "patient_id",
    "sequence_number",
    "captured_at_ms",
    "priority",
    "signal_quality",
    "measurements",
)

_MEASUREMENT_LIMITS = {
    "heart_rate_bpm": (0.0, 300.0),
    "spo2_percent": (0.0, 100.0),
    "temperature_c": (0.0, 60.0),
}

_OPTIONAL_FIELDS = ("risk",)
_UINT32_MAX = 4_294_967_295


class PacketValidationError(ValueError):
    """Raised when a telemetry packet violates the v1 contract."""


def _require_number(value: Any, field: str, minimum: float, maximum: float) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PacketValidationError(f"{field} must be a number")
    if not minimum <= value <= maximum:
        raise PacketValidationError(f"{field} must be between {minimum} and {maximum}")


def validate_packet(packet: Any) -> dict[str, Any]:
    """Validate a packet and return it unchanged for convenient composition."""
    if not isinstance(packet, dict):
        raise PacketValidationError("packet must be an object")

    unknown = set(packet) - set(_REQUIRED_FIELDS) - set(_OPTIONAL_FIELDS)
    if unknown:
        raise PacketValidationError(f"unknown fields: {sorted(unknown)}")

    missing = set(_REQUIRED_FIELDS) - set(packet)
    if missing:
        raise PacketValidationError(f"missing fields: {sorted(missing)}")

    if packet["schema_version"] != SCHEMA_VERSION:
        raise PacketValidationError("unsupported schema_version")

    if packet["packet_type"] != "telemetry":
        raise PacketValidationError("packet_type must be telemetry")

    if not isinstance(packet["device_id"], str) or not _DEVICE_ID.fullmatch(packet["device_id"]):
        raise PacketValidationError("device_id has an invalid format")

    if not isinstance(packet["patient_id"], str) or not _PATIENT_ID.fullmatch(packet["patient_id"]):
        raise PacketValidationError("patient_id has an invalid format")

    for field in ("sequence_number", "captured_at_ms"):
        value = packet[field]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise PacketValidationError(f"{field} must be a non-negative integer")

    if packet["sequence_number"] > _UINT32_MAX:
        raise PacketValidationError("sequence_number exceeds uint32")

    if packet["priority"] not in _PRIORITIES:
        raise PacketValidationError("priority must be routine or critical")

    _require_number(packet["signal_quality"], "signal_quality", 0.0, 1.0)

    measurements = packet["measurements"]
    if not isinstance(measurements, dict):
        raise PacketValidationError("measurements must be an object")
    if set(measurements) != set(_MEASUREMENT_LIMITS):
        raise PacketValidationError("measurements must contain exactly the v1 fields")
    for field, (minimum, maximum) in _MEASUREMENT_LIMITS.items():
        _require_number(measurements[field], field, minimum, maximum)

    if "risk" in packet:
        risk = packet["risk"]
        if not isinstance(risk, dict) or set(risk) != {"level", "score"}:
            raise PacketValidationError("risk must contain exactly level and score")
        if risk["level"] not in _RISK_LEVELS:
            raise PacketValidationError("risk.level is invalid")
        _require_number(risk["score"], "risk.score", 0.0, 100.0)

    return packet


def encode_packet(packet: dict[str, Any]) -> bytes:
    """Validate and encode a packet as compact, deterministic UTF-8 JSON."""
    validate_packet(packet)
    return json.dumps(packet, separators=(",", ":"), sort_keys=True).encode("utf-8")


def decode_packet(raw: bytes) -> dict[str, Any]:
    """Decode UTF-8 JSON bytes and validate the resulting packet."""
    if not isinstance(raw, (bytes, bytearray)):
        raise PacketValidationError("raw packet must be bytes")
    try:
        packet = json.loads(bytes(raw).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PacketValidationError("packet is not valid UTF-8 JSON") from exc
    return validate_packet(packet)


def make_packet(
    *,
    device_id: str,
    patient_id: str,
    sequence_number: int,
    captured_at_ms: int,
    heart_rate_bpm: float,
    spo2_percent: float,
    temperature_c: float,
    priority: str = "routine",
    signal_quality: float = 1.0,
    risk_level: str | None = None,
    risk_score: float | None = None,
) -> dict[str, Any]:
    """Build a validated packet; used by the simulator and by fixtures."""
    packet: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "packet_type": "telemetry",
        "device_id": device_id,
        "patient_id": patient_id,
        "sequence_number": sequence_number,
        "captured_at_ms": captured_at_ms,
        "priority": priority,
        "signal_quality": signal_quality,
        "measurements": {
            "heart_rate_bpm": heart_rate_bpm,
            "spo2_percent": spo2_percent,
            "temperature_c": temperature_c,
        },
    }
    if risk_level is not None and risk_score is not None:
        packet["risk"] = {"level": risk_level, "score": risk_score}
    return validate_packet(packet)
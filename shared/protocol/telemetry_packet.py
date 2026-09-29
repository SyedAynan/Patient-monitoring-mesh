"""Standard-library implementation of the TelemetryPacketV1 contract.

This module is the single authoritative validator for the wire contract. The
ESP32 firmware, the simulator, the gateway, and the backend must all accept
exactly what `validate_packet` accepts, and must reject the same fixture inputs
with the same `code` from `ERROR_CODES` (see `fixtures/manifest.json`).
"""

from __future__ import annotations

import json
import re
from typing import Any

SCHEMA_VERSION = 1

# Stable machine-readable rejection reasons. These are part of the wire contract:
# every implementation must reproduce the same code for the same fixture, so the
# strings below must not be renamed or reworded without a schema version bump.
NOT_AN_OBJECT = "NOT_AN_OBJECT"
UNKNOWN_FIELD = "UNKNOWN_FIELD"
MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
UNSUPPORTED_SCHEMA_VERSION = "UNSUPPORTED_SCHEMA_VERSION"
INVALID_PACKET_TYPE = "INVALID_PACKET_TYPE"
INVALID_DEVICE_ID = "INVALID_DEVICE_ID"
INVALID_PATIENT_ID = "INVALID_PATIENT_ID"
INVALID_SEQUENCE_NUMBER = "INVALID_SEQUENCE_NUMBER"
SEQUENCE_NUMBER_OVERFLOW = "SEQUENCE_NUMBER_OVERFLOW"
INVALID_TIMESTAMP = "INVALID_TIMESTAMP"
INVALID_PRIORITY = "INVALID_PRIORITY"
INVALID_SIGNAL_QUALITY = "INVALID_SIGNAL_QUALITY"
INVALID_MEASUREMENTS = "INVALID_MEASUREMENTS"
INVALID_MEASUREMENT = "INVALID_MEASUREMENT"
INVALID_RISK = "INVALID_RISK"
INVALID_RISK_LEVEL = "INVALID_RISK_LEVEL"
INVALID_RISK_SCORE = "INVALID_RISK_SCORE"
NOT_VALID_JSON = "NOT_VALID_JSON"
NOT_BYTES = "NOT_BYTES"

ERROR_CODES = frozenset(
    {
        NOT_AN_OBJECT,
        UNKNOWN_FIELD,
        MISSING_REQUIRED_FIELD,
        UNSUPPORTED_SCHEMA_VERSION,
        INVALID_PACKET_TYPE,
        INVALID_DEVICE_ID,
        INVALID_PATIENT_ID,
        INVALID_SEQUENCE_NUMBER,
        SEQUENCE_NUMBER_OVERFLOW,
        INVALID_TIMESTAMP,
        INVALID_PRIORITY,
        INVALID_SIGNAL_QUALITY,
        INVALID_MEASUREMENTS,
        INVALID_MEASUREMENT,
        INVALID_RISK,
        INVALID_RISK_LEVEL,
        INVALID_RISK_SCORE,
        NOT_VALID_JSON,
        NOT_BYTES,
    }
)

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
    """Raised when a telemetry packet violates the v1 contract.

    `code` is a stable machine-readable reason drawn from `ERROR_CODES`. The
    human-readable message may change; the code may not.
    """

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def _require_number(
    value: Any,
    field: str,
    minimum: float,
    maximum: float,
    code: str,
) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PacketValidationError(f"{field} must be a number", code)
    if not minimum <= value <= maximum:
        raise PacketValidationError(f"{field} must be between {minimum} and {maximum}", code)


def validate_packet(packet: Any) -> dict[str, Any]:
    """Validate a packet and return it unchanged for convenient composition."""
    if not isinstance(packet, dict):
        raise PacketValidationError("packet must be an object", NOT_AN_OBJECT)

    unknown = set(packet) - set(_REQUIRED_FIELDS) - set(_OPTIONAL_FIELDS)
    if unknown:
        raise PacketValidationError(f"unknown fields: {sorted(unknown)}", UNKNOWN_FIELD)

    missing = set(_REQUIRED_FIELDS) - set(packet)
    if missing:
        raise PacketValidationError(f"missing fields: {sorted(missing)}", MISSING_REQUIRED_FIELD)

    if packet["schema_version"] != SCHEMA_VERSION:
        raise PacketValidationError("unsupported schema_version", UNSUPPORTED_SCHEMA_VERSION)

    if packet["packet_type"] != "telemetry":
        raise PacketValidationError("packet_type must be telemetry", INVALID_PACKET_TYPE)

    if not isinstance(packet["device_id"], str) or not _DEVICE_ID.fullmatch(packet["device_id"]):
        raise PacketValidationError("device_id has an invalid format", INVALID_DEVICE_ID)

    if not isinstance(packet["patient_id"], str) or not _PATIENT_ID.fullmatch(packet["patient_id"]):
        raise PacketValidationError("patient_id has an invalid format", INVALID_PATIENT_ID)

    for field, code in (
        ("sequence_number", INVALID_SEQUENCE_NUMBER),
        ("captured_at_ms", INVALID_TIMESTAMP),
    ):
        value = packet[field]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise PacketValidationError(f"{field} must be a non-negative integer", code)

    if packet["sequence_number"] > _UINT32_MAX:
        raise PacketValidationError("sequence_number exceeds uint32", SEQUENCE_NUMBER_OVERFLOW)

    if packet["priority"] not in _PRIORITIES:
        raise PacketValidationError("priority must be routine or critical", INVALID_PRIORITY)

    _require_number(packet["signal_quality"], "signal_quality", 0.0, 1.0, INVALID_SIGNAL_QUALITY)

    measurements = packet["measurements"]
    if not isinstance(measurements, dict):
        raise PacketValidationError("measurements must be an object", INVALID_MEASUREMENTS)
    if set(measurements) != set(_MEASUREMENT_LIMITS):
        raise PacketValidationError(
            "measurements must contain exactly the v1 fields", INVALID_MEASUREMENTS
        )
    for field, (minimum, maximum) in _MEASUREMENT_LIMITS.items():
        _require_number(measurements[field], field, minimum, maximum, INVALID_MEASUREMENT)

    if "risk" in packet:
        risk = packet["risk"]
        if not isinstance(risk, dict) or set(risk) != {"level", "score"}:
            raise PacketValidationError("risk must contain exactly level and score", INVALID_RISK)
        if risk["level"] not in _RISK_LEVELS:
            raise PacketValidationError("risk.level is invalid", INVALID_RISK_LEVEL)
        _require_number(risk["score"], "risk.score", 0.0, 100.0, INVALID_RISK_SCORE)

    return packet


def encode_packet(packet: dict[str, Any]) -> bytes:
    """Validate and encode a packet as compact, deterministic UTF-8 JSON."""
    validate_packet(packet)
    return json.dumps(packet, separators=(",", ":"), sort_keys=True).encode("utf-8")


def decode_packet(raw: bytes) -> dict[str, Any]:
    """Decode UTF-8 JSON bytes and validate the resulting packet."""
    if not isinstance(raw, (bytes, bytearray)):
        raise PacketValidationError("raw packet must be bytes", NOT_BYTES)
    try:
        packet = json.loads(bytes(raw).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PacketValidationError("packet is not valid UTF-8 JSON", NOT_VALID_JSON) from exc
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
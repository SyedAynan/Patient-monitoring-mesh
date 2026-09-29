"""Regenerate the TelemetryPacketV1 conformance fixtures and their manifest.

Fixtures are derived from the same builder the simulator and tests use, so they
cannot drift from the validator. Run this after any deliberate contract change:

    python tools/generate_fixtures.py

The generated files are committed artifacts: firmware, gateway, and backend read
them as static bytes rather than generating their own.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.protocol import (  # noqa: E402
    SCHEMA_VERSION,
    PacketValidationError,
    encode_packet,
    make_packet,
    validate_packet,
)

FIXTURE_DIR = ROOT / "shared" / "protocol" / "fixtures"
BASE_AT_MS = 1_798_000_000_000


def valid_packets() -> dict[str, bytes]:
    """Packets every implementation must accept."""
    packets = {
        "routine_nominal": make_packet(
            device_id="node-01",
            patient_id="patient-01",
            sequence_number=1,
            captured_at_ms=BASE_AT_MS,
            heart_rate_bpm=72,
            spo2_percent=98,
            temperature_c=36.7,
            signal_quality=0.95,
        ),
        "no_risk_block": make_packet(
            device_id="node-02",
            patient_id="patient-02",
            sequence_number=2,
            captured_at_ms=BASE_AT_MS + 1_000,
            heart_rate_bpm=80,
            spo2_percent=97,
            temperature_c=36.5,
            signal_quality=1.0,
        ),
        "attention_risk": make_packet(
            device_id="node-03",
            patient_id="patient-03",
            sequence_number=3,
            captured_at_ms=BASE_AT_MS + 2_000,
            heart_rate_bpm=104,
            spo2_percent=93,
            temperature_c=37.6,
            signal_quality=0.8,
            risk_level="attention",
            risk_score=45,
        ),
        "critical_alert": make_packet(
            device_id="node-04",
            patient_id="patient-04",
            sequence_number=4,
            captured_at_ms=BASE_AT_MS + 3_000,
            heart_rate_bpm=158,
            spo2_percent=86,
            temperature_c=38.9,
            priority="critical",
            signal_quality=0.72,
            risk_level="critical",
            risk_score=91,
        ),
        "degraded_signal_quality": make_packet(
            device_id="node-05",
            patient_id="patient-05",
            sequence_number=5,
            captured_at_ms=BASE_AT_MS + 4_000,
            heart_rate_bpm=64,
            spo2_percent=95,
            temperature_c=36.4,
            signal_quality=0.0,
            risk_level="normal",
            risk_score=0,
        ),
        "measurement_boundaries": make_packet(
            device_id="node-06",
            patient_id="patient-06",
            sequence_number=6,
            captured_at_ms=BASE_AT_MS + 5_000,
            heart_rate_bpm=300,
            spo2_percent=100,
            temperature_c=60,
            signal_quality=1.0,
            risk_level="normal",
            risk_score=100,
        ),
        "fractional_values": make_packet(
            device_id="node-07",
            patient_id="patient-07",
            sequence_number=7,
            captured_at_ms=BASE_AT_MS + 6_000,
            heart_rate_bpm=72.5,
            spo2_percent=97.25,
            temperature_c=36.65,
            signal_quality=0.123456,
            risk_level="attention",
            risk_score=33.75,
        ),
        "max_sequence_number": make_packet(
            device_id="node-08",
            patient_id="patient-08",
            sequence_number=4_294_967_295,
            captured_at_ms=BASE_AT_MS + 7_000,
            heart_rate_bpm=70,
            spo2_percent=99,
            temperature_c=36.6,
            signal_quality=0.9,
        ),
        "max_device_id_length": make_packet(
            device_id="node-" + "a" * 31,
            patient_id="patient-" + "b" * 31,
            sequence_number=9,
            captured_at_ms=0,
            heart_rate_bpm=70,
            spo2_percent=99,
            temperature_c=36.6,
            signal_quality=0.9,
        ),
    }
    return {name: encode_packet(packet) for name, packet in packets.items()}


def _broken(mutate) -> Any:
    """Build a nominal packet, apply a mutation, and return the raw object."""
    packet = make_packet(
        device_id="node-01",
        patient_id="patient-01",
        sequence_number=10,
        captured_at_ms=BASE_AT_MS,
        heart_rate_bpm=72,
        spo2_percent=98,
        temperature_c=36.7,
        signal_quality=0.9,
    )
    mutate(packet)
    return packet


def _drop(field: str):
    return lambda packet: packet.pop(field)


def _set(field: str, value: Any):
    return lambda packet: packet.__setitem__(field, value)


def _set_measurement(field: str, value: Any):
    return lambda packet: packet["measurements"].__setitem__(field, value)


def _set_risk(**values: Any):
    def mutate(packet: dict) -> None:
        packet["risk"] = values

    return mutate


def _drop_measurement(field: str):
    return lambda packet: packet["measurements"].pop(field)


def invalid_packets() -> dict[str, tuple[Any, str]]:
    """Malformed inputs and the error code each one must produce."""
    return {
        "not_an_object": ([], "NOT_AN_OBJECT"),
        "unknown_field": (
            _broken(_set("patient_name", "must-not-be-accepted")),
            "UNKNOWN_FIELD",
        ),
        "missing_required_field": (_broken(_drop("patient_id")), "MISSING_REQUIRED_FIELD"),
        "unsupported_schema_version": (_broken(_set("schema_version", 2)), "UNSUPPORTED_SCHEMA_VERSION"),
        "invalid_packet_type": (_broken(_set("packet_type", "alert")), "INVALID_PACKET_TYPE"),
        "invalid_device_id": (_broken(_set("device_id", "Node 01")), "INVALID_DEVICE_ID"),
        "invalid_patient_id": (_broken(_set("patient_id", "Patient_01")), "INVALID_PATIENT_ID"),
        "negative_sequence_number": (_broken(_set("sequence_number", -1)), "INVALID_SEQUENCE_NUMBER"),
        "fractional_sequence_number": (_broken(_set("sequence_number", 1.5)), "INVALID_SEQUENCE_NUMBER"),
        "sequence_number_overflow": (
            _broken(_set("sequence_number", 4_294_967_296)),
            "SEQUENCE_NUMBER_OVERFLOW",
        ),
        "negative_timestamp": (_broken(_set("captured_at_ms", -1)), "INVALID_TIMESTAMP"),
        "invalid_priority": (_broken(_set("priority", "urgent")), "INVALID_PRIORITY"),
        "signal_quality_above_range": (_broken(_set("signal_quality", 1.01)), "INVALID_SIGNAL_QUALITY"),
        "signal_quality_not_a_number": (_broken(_set("signal_quality", "high")), "INVALID_SIGNAL_QUALITY"),
        "measurements_not_object": (_broken(_set("measurements", [])), "INVALID_MEASUREMENTS"),
        "measurement_missing_field": (
            _broken(_drop_measurement("temperature_c")),
            "INVALID_MEASUREMENTS",
        ),
        "measurement_out_of_range": (
            _broken(_set_measurement("spo2_percent", 101)),
            "INVALID_MEASUREMENT",
        ),
        "boolean_measurement": (_broken(_set_measurement("heart_rate_bpm", True)), "INVALID_MEASUREMENT"),
        "risk_invalid_level": (_broken(_set_risk(level="unknown", score=10)), "INVALID_RISK_LEVEL"),
        "risk_score_out_of_range": (_broken(_set_risk(level="normal", score=101)), "INVALID_RISK_SCORE"),
        "risk_missing_score": (_broken(_set_risk(level="normal")), "INVALID_RISK"),
    }


def main() -> int:
    for stale in ("valid", "invalid"):
        for path in (FIXTURE_DIR / stale).glob("*.json"):
            path.unlink()

    manifest: dict[str, Any] = {
        "contract": "TelemetryPacketV1",
        "schema_version": SCHEMA_VERSION,
        "schema": "../telemetry_packet.schema.json",
        "note": (
            "Generated by tools/generate_fixtures.py. Valid fixtures are canonical "
            "bytes: decode then re-encode must reproduce the file exactly. Invalid "
            "fixtures must be rejected with the listed error_code and must never crash."
        ),
        "fixtures": [],
    }

    valid_count = 0
    for name, payload in valid_packets().items():
        path = FIXTURE_DIR / "valid" / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        # A generated fixture that does not round-trip is a generator bug.
        if encode_packet(validate_packet(json.loads(payload))) != payload:
            raise SystemExit(f"fixture {name} is not canonical")
        manifest["fixtures"].append(
            {"name": name, "file": f"valid/{name}.json", "expect": "valid"}
        )
        valid_count += 1

    invalid_count = 0
    for name, (payload, code) in invalid_packets().items():
        path = FIXTURE_DIR / "invalid" / f"{name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        # An "invalid" fixture that validates is a generator bug.
        try:
            validate_packet(payload)
        except PacketValidationError as exc:
            if exc.code != code:
                raise SystemExit(f"fixture {name}: expected {code}, validator reported {exc.code}")
        else:
            raise SystemExit(f"fixture {name} unexpectedly validates")
        manifest["fixtures"].append(
            {"name": name, "file": f"invalid/{name}.json", "expect": "invalid", "error_code": code}
        )
        invalid_count += 1

    # Byte-level fixtures: not decodable at all.
    (FIXTURE_DIR / "invalid" / "not_valid_json.json").write_bytes(b"not-json")
    manifest["fixtures"].append(
        {
            "name": "not_valid_json",
            "file": "invalid/not_valid_json.json",
            "expect": "invalid",
            "error_code": "NOT_VALID_JSON",
        }
    )
    (FIXTURE_DIR / "invalid" / "not_utf8.json").write_bytes(b"\xff\xfe\x00")
    manifest["fixtures"].append(
        {
            "name": "not_utf8",
            "file": "invalid/not_utf8.json",
            "expect": "invalid",
            "error_code": "NOT_VALID_JSON",
        }
    )
    invalid_count += 2

    (FIXTURE_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    print(f"valid fixtures:   {valid_count}")
    print(f"invalid fixtures: {invalid_count}")
    print(f"manifest:         {FIXTURE_DIR / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
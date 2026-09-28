"""Emit, encode, decode, and re-validate a representative v1 telemetry packet."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.protocol import decode_packet, encode_packet, make_packet  # noqa: E402


packet = make_packet(
    device_id="node-01",
    patient_id="patient-01",
    sequence_number=42,
    captured_at_ms=1_798_000_000_000,
    heart_rate_bpm=76,
    spo2_percent=98,
    temperature_c=36.8,
    priority="routine",
    signal_quality=0.97,
    risk_level="normal",
    risk_score=8,
)

encoded = encode_packet(packet)
decoded = decode_packet(encoded)

print(f"Encoded size: {len(encoded)} bytes")
print(json.dumps(decoded, indent=2, sort_keys=True))
assert decoded == packet, "round-trip mismatch"
print("Round-trip: PASS")
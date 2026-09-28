"""Contract tests for TelemetryPacketV1."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.protocol import (  # noqa: E402
    PacketValidationError,
    decode_packet,
    encode_packet,
    make_packet,
    validate_packet,
)


def base_packet() -> dict:
    return make_packet(
        device_id="node-01",
        patient_id="patient-01",
        sequence_number=1,
        captured_at_ms=1_798_000_000_000,
        heart_rate_bpm=72,
        spo2_percent=98,
        temperature_c=36.7,
        signal_quality=0.9,
    )


class TelemetryPacketTests(unittest.TestCase):
    def test_valid_packet_round_trips(self) -> None:
        packet = base_packet()
        self.assertEqual(decode_packet(encode_packet(packet)), packet)

    def test_encoding_is_deterministic(self) -> None:
        packet = base_packet()
        self.assertEqual(encode_packet(packet), encode_packet(dict(reversed(list(packet.items())))))

    def test_critical_packet_with_risk_is_valid(self) -> None:
        packet = base_packet()
        packet["priority"] = "critical"
        packet["risk"] = {"level": "critical", "score": 90}
        self.assertIs(validate_packet(packet), packet)

    def test_missing_required_field_is_rejected(self) -> None:
        packet = base_packet()
        del packet["patient_id"]
        with self.assertRaisesRegex(PacketValidationError, "missing fields"):
            validate_packet(packet)

    def test_unknown_field_is_rejected(self) -> None:
        packet = base_packet()
        packet["patient_name"] = "must-not-be-accepted"
        with self.assertRaisesRegex(PacketValidationError, "unknown fields"):
            validate_packet(packet)

    def test_invalid_device_id_is_rejected(self) -> None:
        packet = base_packet()
        packet["device_id"] = "Node 01"
        with self.assertRaisesRegex(PacketValidationError, "device_id"):
            validate_packet(packet)

    def test_unsupported_schema_version_is_rejected(self) -> None:
        packet = base_packet()
        packet["schema_version"] = 2
        with self.assertRaisesRegex(PacketValidationError, "schema_version"):
            validate_packet(packet)

    def test_out_of_range_measurement_is_rejected(self) -> None:
        packet = base_packet()
        packet["measurements"]["spo2_percent"] = 101
        with self.assertRaisesRegex(PacketValidationError, "spo2_percent"):
            validate_packet(packet)

    def test_negative_sequence_number_is_rejected(self) -> None:
        packet = base_packet()
        packet["sequence_number"] = -1
        with self.assertRaisesRegex(PacketValidationError, "sequence_number"):
            validate_packet(packet)

    def test_boolean_is_not_accepted_as_a_number(self) -> None:
        packet = base_packet()
        packet["measurements"]["heart_rate_bpm"] = True
        with self.assertRaisesRegex(PacketValidationError, "heart_rate_bpm"):
            validate_packet(packet)

    def test_invalid_priority_is_rejected(self) -> None:
        packet = base_packet()
        packet["priority"] = "urgent"
        with self.assertRaisesRegex(PacketValidationError, "priority"):
            validate_packet(packet)

    def test_retry_uses_the_same_sequence_number(self) -> None:
        packet = base_packet()
        retry = json.loads(json.dumps(packet))
        self.assertEqual(decode_packet(encode_packet(retry)), packet)
        self.assertEqual(retry["sequence_number"], packet["sequence_number"])

    def test_invalid_json_is_rejected(self) -> None:
        with self.assertRaises(PacketValidationError):
            decode_packet(b"not-json")

    def test_non_utf8_bytes_are_rejected(self) -> None:
        with self.assertRaises(PacketValidationError):
            decode_packet(b"\xff\xfe\x00")


if __name__ == "__main__":
    unittest.main()
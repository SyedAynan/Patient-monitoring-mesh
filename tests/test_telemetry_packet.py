"""Contract tests for TelemetryPacketV1."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from importlib.util import module_from_spec, spec_from_file_location

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.protocol import (  # noqa: E402
    PacketValidationError,
    decode_packet,
    encode_packet,
    make_packet,
    validate_packet,
)


def load_spike_module():
    """Import the Phase 1 feasibility spike by path; `simulator/` is not a package."""
    path = Path(__file__).resolve().parents[1] / "simulator" / "feasibility_spike.py"
    spec = spec_from_file_location("feasibility_spike", path)
    assert spec and spec.loader
    module = module_from_spec(spec)
    # dataclasses resolves annotations through sys.modules, so register first.
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[spec.name]
        raise
    return module


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


class FeasibilitySpikeTests(unittest.TestCase):
    """Regressions for the Phase 1 stand-in spike (see simulator/README.md).

    These assert the reliability rules, not performance: the simulated link runs
    on one clock and proves nothing about radio behaviour.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.spike = load_spike_module()
        cls.result = cls.spike.run_spike()

    def test_spike_is_deterministic(self) -> None:
        self.assertEqual(self.spike.run_spike(), self.result)

    def test_every_emitted_sample_is_delivered_exactly_once(self) -> None:
        result = self.result
        self.assertEqual(result["unique_records"], result["emitted_count"])
        self.assertEqual(result["acked"], result["emitted_count"])
        self.assertEqual(result["buffered_remaining"], 0)

    def test_retries_reuse_the_same_sequence_number(self) -> None:
        """A retried frame must decode back to the same key, not a new sample."""
        _, frame = self.spike.build_sample("node-01", "patient-01", 7)
        first = self.spike.decode_packet(frame)
        retried = self.spike.decode_packet(frame)
        self.assertEqual(
            (first["device_id"], first["sequence_number"]),
            (retried["device_id"], retried["sequence_number"]),
        )
        self.assertEqual(first, retried)
        # The spike actually exercised retries, so the rule was applied to real traffic.
        retry_keys = self.result["retry_keys"]
        self.assertGreater(len(retry_keys), 0)
        self.assertTrue(set(retry_keys).issubset(set(self.result["emitted_samples"])))

    def test_retries_never_produce_duplicate_records(self) -> None:
        receiver = self.spike.Receiver()
        packet, frame = self.spike.build_sample("node-01", "patient-01", 1)
        self.assertTrue(receiver.deliver(frame))
        self.assertFalse(receiver.deliver(frame))
        self.assertEqual(receiver.duplicates_suppressed, 1)
        self.assertEqual(receiver.received, {("node-01", 1): packet})

    def test_stored_records_match_the_emitted_samples(self) -> None:
        passed, detail = self.spike.check_records_are_faithful(self.result)
        self.assertTrue(passed, detail)

    def test_corrupted_frames_are_rejected_safely(self) -> None:
        receiver = self.spike.Receiver()
        self.assertFalse(receiver.deliver(b"\xff\xfe{}"))
        self.assertEqual(receiver.rejected, 1)
        self.assertEqual(receiver.received, {})

    def test_node_buffer_stays_within_its_bound(self) -> None:
        node = self.spike.Node(device_id="node-01", patient_id="patient-01")
        for sequence_number in range(1, self.spike.BUFFER_LIMIT + 6):
            node.enqueue(sequence_number, b"frame")
        self.assertEqual(len(node.buffer), self.spike.BUFFER_LIMIT)
        self.assertEqual(node.high_water, self.spike.BUFFER_LIMIT)
        self.assertEqual(node.refusals, 5)


if __name__ == "__main__":
    unittest.main()
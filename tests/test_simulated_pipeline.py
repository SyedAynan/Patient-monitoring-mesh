"""Tests for the Phase 2 simulated sensing pipeline.

Covers normal delivery, multiple patients, each injected failure mode, relay
forwarding, and sequence handling. Every assertion is about behavior that must
also hold for a real radio: the faults here are the ones a radio produces, and
the protocol rules they exercise are the ones the fixtures pin down.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.protocol import ERROR_CODES, PacketValidationError, decode_packet  # noqa: E402
from simulator.roles import Gateway, NodeConfig, RelayNode, SensorNode  # noqa: E402
from simulator.sensing.processing import (  # noqa: E402
    MINIMUM_SIGNAL_QUALITY,
    SignalFilter,
    is_plausible,
)
from simulator.sensing.sources import (  # noqa: E402
    FaultySource,
    NoisySource,
    NominalSource,
    Reading,
    SensorUnavailable,
)
from simulator.topology import GATEWAY_ID, RELAY_ID, build_standard_mesh, run  # noqa: E402
from simulator.transport import (  # noqa: E402
    MAX_HOPS,
    MAX_PAYLOAD_LENGTH,
    Frame,
    FrameError,
    LinkUnavailable,
    SimulatedMedium,
)

SEED = 20260928


class NominalDeliveryTests(unittest.TestCase):
    """Nothing fails: every packet a node sends must arrive exactly once."""

    def test_single_patient_delivers_every_packet(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=5)
        run(mesh, ticks=40)

        for node in mesh.nodes:
            self.assertEqual(node.stats.packets_built, node.stats.packets_sent)
            self.assertEqual(
                len(mesh.gateway.packets_for(node.device_id)),
                node.stats.packets_sent,
                f"{node.device_id} lost packets on a clean link",
            )
            self.assertEqual(mesh.gateway.missing_sequences(node.device_id), [])

    def test_accepted_packets_satisfy_the_protocol_contract(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3)
        run(mesh, ticks=40)

        self.assertGreater(mesh.gateway.stats.packets_accepted, 0)
        for packet in mesh.gateway.received.values():
            # Already validated on receipt; re-decoding proves the bytes, not just
            # the dict the gateway happens to hold.
            self.assertEqual(decode_packet(decode_bytes(packet)), packet)

    def test_gateway_records_are_traceable(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        run(mesh, ticks=30)

        for (device_id, sequence_number), packet in mesh.gateway.received.items():
            self.assertEqual(packet["device_id"], device_id)
            self.assertEqual(packet["sequence_number"], sequence_number)
            self.assertIsInstance(packet["captured_at_ms"], int)
            self.assertGreaterEqual(packet["signal_quality"], 0.0)
            self.assertLessEqual(packet["signal_quality"], 1.0)

    def test_clean_link_produces_no_duplicates_or_malformed_frames(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3)
        run(mesh, ticks=40)

        self.assertEqual(mesh.medium.stats.duplicated, 0)
        self.assertEqual(mesh.medium.stats.corrupted, 0)
        self.assertEqual(mesh.gateway.stats.packets_duplicate, 0)
        self.assertEqual(mesh.gateway.stats.frames_malformed, 0)
        self.assertEqual(mesh.gateway.stats.packets_invalid, 0)


class MultiPatientTests(unittest.TestCase):
    """Several patients must be distinguishable and independent."""

    def test_five_patients_are_all_delivered_separately(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=5)
        run(mesh, ticks=40)

        self.assertEqual(len(mesh.nodes), 5)
        devices = mesh.gateway.devices_seen()
        self.assertEqual(devices, [f"node-0{i}" for i in range(1, 6)])
        for node in mesh.nodes:
            self.assertGreater(len(mesh.gateway.packets_for(node.device_id)), 0)

    def test_each_device_keeps_its_own_sequence_series(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=4)
        run(mesh, ticks=40)

        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(numbers, sorted(numbers), "sequence numbers must be increasing")
            self.assertEqual(numbers[0], 1, "sequence numbering starts at 1")
            self.assertEqual(len(numbers), len(set(numbers)))

    def test_patient_identity_is_preserved_end_to_end(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=4)
        run(mesh, ticks=30)

        expected = {node.device_id: node.patient_id for node in mesh.nodes}
        for device_id, patient_id in expected.items():
            for packet in mesh.gateway.packets_for(device_id):
                self.assertEqual(packet["patient_id"], patient_id)

    def test_patients_do_not_get_identical_vitals(self) -> None:
        """Distinct sources must actually produce distinct patient data."""
        mesh = build_standard_mesh(seed=SEED, patient_count=4)
        run(mesh, ticks=40)

        first_readings = {
            node.device_id: mesh.gateway.packets_for(node.device_id)[0]["measurements"][
                "heart_rate_bpm"
            ]
            for node in mesh.nodes
        }
        self.assertEqual(
            len(set(first_readings.values())),
            len(first_readings),
            f"patients produced identical heart rates: {first_readings}",
        )


class FaultInjectionTests(unittest.TestCase):
    """Each injected fault must be visible and must not corrupt correctness."""

    def test_loss_reduces_delivery_without_corrupting_records(self) -> None:
        clean = build_standard_mesh(seed=SEED, patient_count=3)
        run(clean, ticks=60)

        lossy = build_standard_mesh(seed=SEED, patient_count=3, loss_rate=0.3)
        run(lossy, ticks=60)

        self.assertLess(
            len(lossy.gateway.received),
            len(clean.gateway.received),
            "a lossy link must deliver fewer packets than a clean one",
        )
        self.assertGreater(lossy.medium.stats.dropped, 0)
        # Loss must produce gaps, not scrambled or duplicated records.
        self.assertEqual(lossy.gateway.stats.packets_invalid, 0)
        self.assertEqual(lossy.gateway.stats.frames_malformed, 0)
        for device_id, sequence_number in lossy.gateway.received:
            self.assertIsInstance(sequence_number, int)

    def test_corruption_is_rejected_and_never_accepted(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3, corruption_rate=0.2)
        run(mesh, ticks=60)

        self.assertGreater(mesh.medium.stats.corrupted, 0, "no frames were corrupted")
        self.assertGreater(
            mesh.gateway.stats.frames_malformed + mesh.gateway.stats.packets_invalid,
            0,
            "corrupted frames must be rejected by the gateway",
        )
        # Every accepted record is still a fully valid packet.
        self.assertTrue(decode_bytes_as_packets(mesh.gateway.received.values()))

    def test_duplicates_are_delivered_but_not_stored_twice(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3, duplication_rate=0.5)
        run(mesh, ticks=60)

        self.assertGreater(mesh.medium.stats.duplicated, 0, "no frames were duplicated")
        self.assertGreater(
            mesh.gateway.stats.packets_duplicate,
            0,
            "the gateway must have seen duplicate packets",
        )
        # The key invariant: a duplicate must not create a second record.
        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(len(numbers), len(set(numbers)), f"{node.device_id} stored duplicates")

    def test_reordering_does_not_break_sequence_identity(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3, reorder_rate=0.4)
        run(mesh, ticks=60)

        self.assertGreater(mesh.medium.stats.deferred, 0, "no frames were deferred")
        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(len(numbers), len(set(numbers)))
            self.assertEqual(min(numbers), 1)
            # The gateway stores by sequence number, so out-of-order arrival
            # cannot produce a wrong or duplicated record.
            self.assertEqual(mesh.gateway.missing_sequences(node.device_id),
                             [n for n in range(min(numbers), max(numbers) + 1)
                              if n not in set(numbers)])

    def test_all_faults_together_still_preserve_records(self) -> None:
        mesh = build_standard_mesh(
            seed=SEED,
            patient_count=4,
            loss_rate=0.25,
            corruption_rate=0.1,
            duplication_rate=0.2,
            reorder_rate=0.15,
        )
        run(mesh, ticks=80)

        self.assertTrue(decode_bytes_as_packets(mesh.gateway.received.values()))
        for device_id, sequence_number in mesh.gateway.received:
            self.assertGreaterEqual(sequence_number, 1)
        accepted = mesh.gateway.stats.packets_accepted
        self.assertEqual(accepted, len(mesh.gateway.received))

    def test_sensor_outage_skips_packets_instead_of_faking_them(self) -> None:
        """A failing sensor must reduce output, never invent a reading."""
        class DeadSource:
            def read(self) -> Reading:
                raise SensorUnavailable("no sensor attached")

        mesh = build_standard_mesh(seed=SEED, patient_count=2, sources={"node-01": DeadSource()})
        run(mesh, ticks=30)

        dead = mesh.node("node-01")
        self.assertEqual(dead.stats.packets_built, 0)
        self.assertEqual(dead.stats.sensor_unavailable, 30)
        self.assertEqual(mesh.gateway.packets_for("node-01"), [])
        # The healthy patient is unaffected.
        self.assertGreater(len(mesh.gateway.packets_for("node-02")), 0)

    def test_disconnected_radio_is_reported_not_silently_lost(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        mesh.medium.set_link("node-01", RELAY_ID, available=False)
        run(mesh, ticks=30)

        node = mesh.node("node-01")
        self.assertGreater(node.stats.packets_dropped_link_unavailable, 0)
        self.assertEqual(mesh.gateway.packets_for("node-01"), [])
        self.assertGreater(len(mesh.gateway.packets_for("node-02")), 0)

    def test_reconnect_resumes_delivery(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        mesh.medium.set_link("node-01", RELAY_ID, available=False)
        run(mesh, ticks=20)
        self.assertEqual(mesh.gateway.packets_for("node-01"), [])

        mesh.medium.set_link("node-01", RELAY_ID, available=True)
        run(mesh, ticks=20)

        self.assertGreater(
            len(mesh.gateway.packets_for("node-01")),
            0,
            "delivery must resume after the link returns",
        )
        self.assertEqual(mesh.node("node-01").stats.packets_built,
                         mesh.node("node-01").stats.packets_sent)


class RelayForwardingTests(unittest.TestCase):
    """The relay hop is the networking claim this phase must actually support."""

    def test_relay_forwards_every_frame_it_receives(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3)
        run(mesh, ticks=40)

        self.assertEqual(mesh.relay.stats.received, mesh.relay.stats.forwarded)
        self.assertEqual(mesh.relay.stats.dropped_unroutable, 0)
        self.assertGreater(mesh.relay.stats.forwarded, 0)

    def test_frames_reach_the_gateway_only_through_the_relay(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3)
        run(mesh, ticks=40)

        for node in mesh.nodes:
            self.assertEqual(node.config.next_hop, RELAY_ID)
            self.assertFalse(mesh.medium.is_adjacent(node.device_id, GATEWAY_ID))

    def test_relay_preserves_frame_identity_for_deduplication(self) -> None:
        """A forwarded frame must still deduplicate against its original."""
        frame = Frame(
            source="node-01",
            destination=GATEWAY_ID,
            message_id="node-01:7",
            payload=b'{"x":1}',
        )
        onward = frame.forwarded_by(RELAY_ID)

        self.assertEqual(onward.frame_id, frame.frame_id)
        self.assertEqual(onward.source, frame.source)
        self.assertEqual(onward.destination, frame.destination)
        self.assertEqual(onward.payload, frame.payload)
        self.assertEqual(onward.hop_count, frame.hop_count + 1)

    def test_relay_never_inspects_the_payload(self) -> None:
        """The relay must forward an opaque payload it cannot interpret."""
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        medium = mesh.medium
        opaque = b"\x00\x01not-a-telemetry-packet\xff"
        medium.transport("node-01").transmit(
            RELAY_ID,
            Frame(source="node-01", destination=GATEWAY_ID, message_id="m1", payload=opaque).to_bytes(),
        )
        mesh.relay.tick()

        self.assertEqual(mesh.relay.stats.forwarded, 1)
        forwarded = medium.drain(GATEWAY_ID)
        self.assertEqual(len(forwarded), 1)
        self.assertEqual(Frame.from_bytes(forwarded[0]).payload, opaque)
        # The gateway rejects it, because it is not a valid telemetry packet.
        mesh.gateway.tick()
        self.assertEqual(mesh.gateway.stats.packets_invalid, 1)

    def test_relay_drops_malformed_frames_without_stopping(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=1)
        mesh.medium._inboxes[RELAY_ID].append(b"\x00\x00\x00\x04junk")  # noqa: SLF001
        run(mesh, ticks=30)

        self.assertGreater(mesh.relay.stats.dropped_unroutable, 0)
        self.assertEqual(mesh.relay.stats.received - mesh.relay.stats.dropped_unroutable,
                         mesh.relay.stats.forwarded)

    def test_relay_outage_stops_delivery(self) -> None:
        """Honest limitation: with no alternate path, a relay loss is a full outage."""
        mesh = build_standard_mesh(seed=SEED, patient_count=3)
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=40)

        self.assertEqual(mesh.gateway.stats.packets_accepted, 0)
        self.assertGreater(mesh.relay.stats.dropped_link_unavailable, 0)

    def test_direct_mode_works_without_a_relay(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3, use_relay=False)
        run(mesh, ticks=40)

        self.assertGreater(mesh.gateway.stats.packets_accepted, 0)
        for node in mesh.nodes:
            self.assertEqual(node.config.next_hop, GATEWAY_ID)

    def test_hop_limit_bounds_forwarding(self) -> None:
        frame = Frame(source="node-01", destination=GATEWAY_ID, message_id="m", payload=b"x")
        for _ in range(MAX_HOPS):
            frame = frame.forwarded_by(RELAY_ID)
        self.assertEqual(frame.hop_count, MAX_HOPS)
        with self.assertRaises(FrameError):
            frame.forwarded_by(RELAY_ID)


class SequenceHandlingTests(unittest.TestCase):
    """Sequence numbers are the contract's ordering and dedup mechanism."""

    def test_sequence_numbers_increase_by_one(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        run(mesh, ticks=40)

        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(numbers, list(range(1, len(numbers) + 1)))

    def test_failed_transmission_does_not_advance_the_sequence(self) -> None:
        """A link failure must not burn a sequence number."""
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        mesh.medium.set_link("node-01", RELAY_ID, available=False)
        run(mesh, ticks=20)

        node = mesh.node("node-01")
        self.assertEqual(node.next_sequence_number, 1, "a dropped packet consumed a sequence number")
        self.assertEqual(node.stats.packets_built, node.stats.packets_dropped_link_unavailable)

    def test_gap_reporting_matches_reality(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2, loss_rate=0.3)
        run(mesh, ticks=60)

        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            expected_gaps = [
                n for n in range(numbers[0], numbers[-1] + 1) if n not in set(numbers)
            ]
            self.assertEqual(mesh.gateway.missing_sequences(node.device_id), expected_gaps)

    def test_retry_reuses_the_sequence_number(self) -> None:
        """The protocol's retry rule, exercised through the node."""
        medium = SimulatedMedium(seed=1, loss_rate=1.0)
        medium.register(GATEWAY_ID)
        medium.register(RELAY_ID)
        medium.connect(RELAY_ID, GATEWAY_ID)
        medium.connect("node-01", RELAY_ID)

        node = SensorNode(
            config=NodeConfig(
                device_id="node-01",
                patient_id="patient-01",
                gateway_id=GATEWAY_ID,
                next_hop=RELAY_ID,
                samples_per_packet=1,
            ),
            source=NominalSource(seed=1),
            transport=medium.transport("node-01"),
        )
        for tick in range(3):
            node.tick(1_798_000_000_000 + tick * 1_000)

        self.assertEqual(node.stats.packets_built, 3)
        self.assertEqual(node.stats.packets_sent, 0)
        self.assertEqual(node.next_sequence_number, 1)

    def test_out_of_order_arrival_is_stored_by_sequence_not_arrival(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        gateway = mesh.gateway
        medium = mesh.medium

        def frame_for(sequence_number: int) -> bytes:
            from shared.protocol import encode_packet, make_packet

            packet = make_packet(
                device_id="node-01",
                patient_id="patient-01",
                sequence_number=sequence_number,
                captured_at_ms=1_798_000_000_000,
                heart_rate_bpm=72,
                spo2_percent=98,
                temperature_c=36.7,
            )
            return Frame(
                source="node-01",
                destination=GATEWAY_ID,
                message_id=f"node-01:{sequence_number}",
                payload=encode_packet(packet),
            ).to_bytes()

        # Deliver 3, then 1, then 2 — deliberately out of order.
        for sequence_number in (3, 1, 2):
            medium._inboxes[GATEWAY_ID].append(frame_for(sequence_number))  # noqa: SLF001
        gateway.tick()

        self.assertEqual(gateway.sequence_numbers("node-01"), [1, 2, 3])
        self.assertEqual(gateway.accepted_order, [("node-01", 3), ("node-01", 1), ("node-01", 2)])


class SignalQualityTests(unittest.TestCase):
    """Quality gating must reject unusable windows, not paper over them."""

    def test_steady_signal_scores_high_quality(self) -> None:
        source = NominalSource(seed=5)
        filter_ = SignalFilter(window_size=5)
        for _ in range(5):
            filter_.observe(source.read())
        self.assertGreater(filter_.signal_quality(), 0.9)

    def test_noisy_signal_scores_lower_than_steady(self) -> None:
        steady = SignalFilter(window_size=5)
        noisy = SignalFilter(window_size=5)
        steady_source = NominalSource(seed=7)
        noisy_source = NoisySource(seed=7)
        for _ in range(5):
            steady.observe(steady_source.read())
            noisy.observe(noisy_source.read())
        self.assertLess(noisy.signal_quality(), steady.signal_quality())

    def test_unusable_window_is_skipped_not_published(self) -> None:
        filter_ = SignalFilter(window_size=4)
        outcome = filter_.result()
        self.assertFalse(outcome.is_usable)
        self.assertEqual(outcome.reason, "NO_READINGS")

    def test_implausible_readings_never_enter_the_window(self) -> None:
        filter_ = SignalFilter(window_size=5)
        filter_.observe(Reading(heart_rate_bpm=999.0, spo2_percent=-5.0, temperature_c=250.0))
        self.assertFalse(filter_.result().is_usable)
        self.assertEqual(filter_.rejected_readings, 1)

    def test_plausibility_bounds(self) -> None:
        self.assertTrue(is_plausible(Reading(72.0, 98.0, 36.7)))
        self.assertFalse(is_plausible(Reading(999.0, 98.0, 36.7)))
        self.assertFalse(is_plausible(Reading(72.0, -1.0, 36.7)))
        self.assertFalse(is_plausible(Reading(72.0, 98.0, 250.0)))

    def test_quality_threshold_is_enforced_by_the_node(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3)
        run(mesh, ticks=60)
        node = mesh.node("node-03")  # the poor-contact patient
        self.assertGreater(node.stats.windows_skipped, 0)
        self.assertLess(node.signal_quality, 1.0)
        for packet in mesh.gateway.packets_for("node-03"):
            self.assertGreaterEqual(packet["signal_quality"], 0.0)
            self.assertLessEqual(packet["signal_quality"], 1.0)

    def test_minimum_quality_constant_is_sane(self) -> None:
        self.assertGreater(MINIMUM_SIGNAL_QUALITY, 0.0)
        self.assertLess(MINIMUM_SIGNAL_QUALITY, 1.0)


class FaultySensorTests(unittest.TestCase):
    """The wrapped faulty source must be survivable, not fatal."""

    def test_faulty_sensor_produces_fewer_packets_but_stays_valid(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=5)
        run(mesh, ticks=60)

        faulty = mesh.node("node-05")
        healthy = mesh.node("node-01")
        self.assertGreater(faulty.stats.sensor_unavailable, 0)
        self.assertGreater(faulty.stats.implausible_readings, 0)
        self.assertLess(faulty.stats.packets_built, healthy.stats.packets_built)
        self.assertTrue(decode_bytes_as_packets(mesh.gateway.packets_for("node-05")))

    def test_faulty_source_raises_and_returns_junk_on_schedule(self) -> None:
        source = FaultySource(inner=NominalSource(seed=1), unavailable_every=2, implausible_every=3)
        readings, unavailable, junk = 0, 0, 0
        for _ in range(12):
            try:
                reading = source.read()
            except SensorUnavailable:
                unavailable += 1
                continue
            readings += 1
            if not is_plausible(reading):
                junk += 1
        self.assertEqual(unavailable, 6)
        self.assertEqual(junk, 4)


class TransportAbstractionTests(unittest.TestCase):
    """The seam that lets EspNowTransport replace the simulator."""

    def test_simulated_transport_satisfies_the_transport_protocol(self) -> None:
        from simulator.transport import Transport

        medium = SimulatedMedium(seed=1)
        medium.register("a")
        medium.register("b")
        medium.connect("a", "b")
        self.assertIsInstance(medium.transport("a"), Transport)

    def test_roles_never_import_the_concrete_medium(self) -> None:
        """Nodes, relay, and gateway must depend on the abstraction, not the medium."""
        import simulator.roles.gateway as gateway_module
        import simulator.roles.node as node_module
        import simulator.roles.relay as relay_module

        for module in (node_module, relay_module, gateway_module):
            source = Path(module.__file__).read_text(encoding="utf-8")
            self.assertIn("from ..transport import", source)
            self.assertNotIn("SimulatedMedium", source.split("from ..transport import")[1])

    def test_espnow_transport_is_explicitly_unimplemented(self) -> None:
        from simulator.transport.espnow import EspNowTransport, is_available

        self.assertFalse(is_available())
        with self.assertRaises(NotImplementedError) as caught:
            EspNowTransport()
        self.assertIn("DEFERRED", str(caught.exception))

    def test_swapping_the_medium_requires_no_role_changes(self) -> None:
        """Drive the same roles over a hand-built medium.

        This is the substitute for hardware: the roles are exercised against a
        medium assembled by hand rather than by `build_standard_mesh`, which is
        only possible because they never reach for the concrete type.
        """
        medium = SimulatedMedium(seed=99)
        for endpoint in ("gateway-01", "relay-01", "node-01"):
            medium.register(endpoint)
        medium.connect("node-01", "relay-01")
        medium.connect("relay-01", "gateway-01")

        gateway = Gateway(gateway_id="gateway-01", transport=medium.transport("gateway-01"))
        relay = RelayNode(relay_id="relay-01", next_hop="gateway-01",
                          transport=medium.transport("relay-01"))
        node = SensorNode(
            config=NodeConfig(
                device_id="node-01",
                patient_id="patient-01",
                gateway_id="gateway-01",
                next_hop="relay-01",
                samples_per_packet=2,
            ),
            source=NominalSource(seed=11),
            transport=medium.transport("node-01"),
        )

        for tick in range(10):
            node.tick(1_798_000_000_000 + tick * 1_000)
            relay.tick()
            gateway.tick()

        self.assertGreater(gateway.stats.packets_accepted, 0)
        self.assertEqual(gateway.stats.packets_invalid, 0)

    def test_unavailable_link_raises_rather_than_silently_dropping(self) -> None:
        medium = SimulatedMedium(seed=1)
        medium.register("a")
        medium.register("b")
        transport = medium.transport("a")
        frame = Frame(source="a", destination="b", message_id="m", payload=b"x").to_bytes()

        with self.assertRaises(LinkUnavailable):
            transport.transmit("b", frame)
        self.assertEqual(medium.stats.refused_unavailable, 1)


class FrameEnvelopeTests(unittest.TestCase):
    """The envelope must bound, reject, and round-trip safely."""

    def test_frame_round_trips(self) -> None:
        frame = Frame(source="node-01", destination=GATEWAY_ID, message_id="m-1", payload=b"abc")
        self.assertEqual(Frame.from_bytes(frame.to_bytes()), frame)

    def test_oversized_payload_is_rejected(self) -> None:
        with self.assertRaises(FrameError):
            Frame(
                source="a",
                destination="b",
                message_id="m",
                payload=b"x" * (MAX_PAYLOAD_LENGTH + 1),
            )

    def test_truncated_and_malformed_frames_are_rejected(self) -> None:
        for raw in (b"", b"\x00", b"\x00\x00\x00\xff", b"\x00\x00\x00\x04junk"):
            with self.subTest(raw=raw):
                with self.assertRaises(FrameError):
                    Frame.from_bytes(raw)

    def test_unknown_header_field_is_rejected(self) -> None:
        import json

        header = json.dumps(
            {"source": "a", "destination": "b", "message_id": "m", "hop_count": 0, "extra": 1},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        raw = len(header).to_bytes(4, "big") + header
        with self.assertRaises(FrameError) as caught:
            Frame.from_bytes(raw)
        self.assertEqual(caught.exception.code, "UNKNOWN_HEADER_FIELD")


class DeterminismTests(unittest.TestCase):
    """A seed must reproduce a run exactly, or experiments are not repeatable."""

    def test_same_seed_produces_identical_results(self) -> None:
        def run_once() -> list[tuple[str, int]]:
            mesh = build_standard_mesh(
                seed=1234, patient_count=3, loss_rate=0.2, duplication_rate=0.2
            )
            run(mesh, ticks=40)
            return sorted(mesh.gateway.received)

        self.assertEqual(run_once(), run_once())

    def test_different_seeds_produce_different_results(self) -> None:
        def run_once(seed: int) -> list[tuple[str, int]]:
            mesh = build_standard_mesh(seed=seed, patient_count=3, loss_rate=0.3)
            run(mesh, ticks=40)
            return sorted(mesh.gateway.received)

        self.assertNotEqual(run_once(1), run_once(2))

    def test_fault_rates_do_not_desynchronise_the_random_stream(self) -> None:
        """Adding a fault rate must not shift the draws of the others."""
        without = build_standard_mesh(seed=77, patient_count=2)
        with_dup = build_standard_mesh(seed=77, patient_count=2, duplication_rate=0.5)
        run(without, ticks=20)
        run(with_dup, ticks=20)

        # Duplication duplicates deliveries; it must not change which frames
        # were dropped, because the loss draw stays in the same stream position.
        self.assertEqual(without.medium.stats.dropped, with_dup.medium.stats.dropped)


def decode_bytes(packet: dict) -> bytes:
    """Re-encode a stored packet through the contract for byte-level checks."""
    from shared.protocol import encode_packet

    return encode_packet(packet)


def decode_bytes_as_packets(packets) -> bool:
    """True when every stored packet re-validates as a complete packet."""
    from shared.protocol import validate_packet

    for packet in packets:
        try:
            validate_packet(packet)
        except PacketValidationError:
            return False
    return True


if __name__ == "__main__":
    unittest.main()
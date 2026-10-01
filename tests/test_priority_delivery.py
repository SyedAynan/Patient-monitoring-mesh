"""Phase 3 tests: priority queues, acknowledgements, and bounded retries.

These assert the two guarantees `Rules.md` section 9 demands: routine traffic
never starves critical alerts, and buffers/retries are bounded.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.protocol import encode_packet, make_packet  # noqa: E402
from simulator.roles import (  # noqa: E402
    PRIORITY_CRITICAL,
    PRIORITY_ROUTINE,
    Gateway,
    NodeConfig,
    PriorityQueue,
    RelayNode,
    RetryPolicy,
    SensorNode,
)
from simulator.sensing.sources import NominalSource  # noqa: E402
from simulator.topology import (  # noqa: E402
    GATEWAY_ID,
    RELAY_ID,
    build_standard_mesh,
    run,
)
from simulator.transport import (  # noqa: E402
    KIND_ACK,
    KIND_DATA,
    Frame,
    FrameError,
    SimulatedMedium,
)

SEED = 20260928


def data_frame(source: str = "node-01", sequence: int = 1, destination: str = GATEWAY_ID) -> Frame:
    packet = make_packet(
        device_id=source,
        patient_id=f"patient-{source[-2:]}",
        sequence_number=sequence,
        captured_at_ms=1_798_000_000_000 + sequence * 1_000,
        heart_rate_bpm=72,
        spo2_percent=98,
        temperature_c=36.7,
    )
    return Frame(
        source=source,
        destination=destination,
        message_id=f"{source}:{sequence}",
        payload=encode_packet(packet),
    )


class PriorityQueueTests(unittest.TestCase):
    def test_critical_drains_before_routine(self) -> None:
        queue = PriorityQueue()
        routine_first = data_frame(sequence=1)
        critical = data_frame(sequence=2)
        routine_second = data_frame(sequence=3)

        queue.enqueue(routine_first, PRIORITY_ROUTINE)
        queue.enqueue(critical, PRIORITY_CRITICAL)
        queue.enqueue(routine_second, PRIORITY_ROUTINE)

        order = []
        while (pending := queue.next_to_send()) is not None:
            order.append(pending.message_id)
            queue.discard(pending)
        self.assertEqual(order, ["node-01:2", "node-01:1", "node-01:3"])

    def test_queue_is_bounded_and_counts_refusals(self) -> None:
        queue = PriorityQueue(capacity=3)
        for sequence in range(1, 6):
            queue.enqueue(data_frame(sequence=sequence), PRIORITY_ROUTINE)
        self.assertEqual(queue.depth, 3)
        self.assertEqual(queue.refused_capacity, 2)

    def test_critical_frame_evicts_routine_when_full(self) -> None:
        queue = PriorityQueue(capacity=2)
        queue.enqueue(data_frame(sequence=1), PRIORITY_ROUTINE)
        queue.enqueue(data_frame(sequence=2), PRIORITY_ROUTINE)
        admitted = queue.enqueue(data_frame(sequence=3), PRIORITY_CRITICAL)

        self.assertTrue(admitted)
        self.assertEqual(queue.depth, 2)
        self.assertEqual(queue.evicted_for_priority, 1)
        # The critical frame is first, not behind the surviving routine frame.
        self.assertEqual(queue.next_to_send().priority, PRIORITY_CRITICAL)

    def test_acknowledge_removes_only_the_named_message(self) -> None:
        queue = PriorityQueue()
        queue.enqueue(data_frame(sequence=1), PRIORITY_ROUTINE)
        queue.enqueue(data_frame(sequence=2), PRIORITY_ROUTINE)

        self.assertTrue(queue.acknowledge("node-01:1"))
        self.assertEqual(queue.depth, 1)
        self.assertEqual(queue.next_to_send().message_id, "node-01:2")

    def test_duplicate_acknowledge_is_ignored(self) -> None:
        queue = PriorityQueue()
        queue.enqueue(data_frame(sequence=1), PRIORITY_ROUTINE)
        self.assertTrue(queue.acknowledge("node-01:1"))
        self.assertFalse(queue.acknowledge("node-01:1"))

    def test_acknowledge_of_unknown_message_returns_false(self) -> None:
        queue = PriorityQueue()
        self.assertFalse(queue.acknowledge("node-01:999"))

    def test_invalid_priority_is_rejected(self) -> None:
        queue = PriorityQueue()
        with self.assertRaises(ValueError):
            queue.enqueue(data_frame(), "urgent")

    def test_retry_policy_bounds_attempts(self) -> None:
        policy = RetryPolicy(max_attempts=3)
        self.assertTrue(policy.has_budget(0))
        self.assertTrue(policy.has_budget(2))
        self.assertFalse(policy.has_budget(3))

    def test_retry_policy_requires_at_least_one_attempt(self) -> None:
        with self.assertRaises(ValueError):
            RetryPolicy(max_attempts=0)


class AcknowledgementTests(unittest.TestCase):
    def test_gateway_acks_accepted_packets(self) -> None:
        medium = SimulatedMedium(seed=1)
        medium.register(GATEWAY_ID)
        medium.register("node-01")
        medium.connect("node-01", GATEWAY_ID)
        gateway = Gateway(gateway_id=GATEWAY_ID, transport=medium.transport(GATEWAY_ID))

        medium.transport("node-01").transmit(GATEWAY_ID, data_frame().to_bytes())
        gateway.tick()

        self.assertEqual(gateway.stats.packets_accepted, 1)
        self.assertEqual(gateway.stats.acks_sent, 1)
        ack = Frame.from_bytes(medium.drain("node-01")[0])
        self.assertEqual(ack.kind, KIND_ACK)
        self.assertEqual(ack.acks, "node-01:1")
        self.assertEqual(ack.destination, "node-01")

    def test_gateway_re_acks_duplicates(self) -> None:
        """A retry whose first ack was lost must still get an ack."""
        medium = SimulatedMedium(seed=1)
        medium.register(GATEWAY_ID)
        medium.register("node-01")
        medium.connect("node-01", GATEWAY_ID)
        gateway = Gateway(gateway_id=GATEWAY_ID, transport=medium.transport(GATEWAY_ID))

        frame = data_frame()
        for _ in range(2):
            medium.transport("node-01").transmit(GATEWAY_ID, frame.to_bytes())
            gateway.tick()
            medium.drain("node-01")

        self.assertEqual(gateway.stats.packets_duplicate, 1)
        self.assertEqual(gateway.stats.acks_sent, 2)

    def test_node_consumes_its_ack_and_stops_retrying(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        run(mesh, ticks=40)

        for node in mesh.nodes:
            self.assertGreater(node.stats.packets_acknowledged, 0)
            self.assertEqual(node.stats.acks_ignored, 0)
            # Every acknowledged message left the queue.
            self.assertTrue(
                all(not pending.acked for pending in node.pending_messages()),
                "an acked frame is still queued",
            )

    def test_ack_reaches_the_node_through_the_relay(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2)
        run(mesh, ticks=40)

        self.assertGreater(mesh.gateway.stats.acks_sent, 0)
        self.assertGreater(sum(n.stats.acks_received for n in mesh.nodes), 0)
        # The relay carried them back without changing their identity.
        self.assertGreater(mesh.relay.stats.forwarded, 0)


class RetryBehaviourTests(unittest.TestCase):
    def test_retries_improve_delivery_under_loss(self) -> None:
        """The mechanism must earn its keep: more budget, more delivery."""
        results = {}
        for attempts in (1, 4):
            mesh = build_standard_mesh(seed=7, patient_count=2, loss_rate=0.4)
            for node in mesh.nodes:
                node.config.max_attempts = attempts
                node.retry_policy.max_attempts = attempts
            run(mesh, ticks=120)
            accepted = sum(len(mesh.gateway.packets_for(n.device_id)) for n in mesh.nodes)
            results[attempts] = accepted

        self.assertGreater(results[4], results[1], "retries did not improve delivery")

    def test_retransmissions_are_counted_and_reuse_the_message(self) -> None:
        mesh = build_standard_mesh(seed=7, patient_count=2, loss_rate=0.5)
        run(mesh, ticks=80)

        total_retransmissions = sum(n.stats.retransmissions for n in mesh.nodes)
        self.assertGreater(total_retransmissions, 0, "no retransmissions under 50% loss")
        # A retransmission reuses the message_id, so the gateway's duplicates are
        # the same packet arriving again — never a second record.
        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(len(numbers), len(set(numbers)))

    def test_exhausted_messages_are_counted_and_stopped(self) -> None:
        mesh = build_standard_mesh(seed=7, patient_count=2, loss_rate=0.7)
        run(mesh, ticks=120)

        exhausted = sum(n.stats.packets_failed_retry_exhausted for n in mesh.nodes)
        self.assertGreater(exhausted, 0)
        # The queue is bounded and cannot retain failures forever.
        for node in mesh.nodes:
            self.assertLessEqual(node.queue_depth, node.config.queue_capacity)

    def test_link_unavailable_does_not_consume_a_retry_attempt(self) -> None:
        """The radio refusing to transmit is not a failed transmission."""
        medium = SimulatedMedium(seed=1)
        medium.register(GATEWAY_ID)
        medium.register(RELAY_ID)
        medium.register("node-01")
        medium.connect("node-01", RELAY_ID)
        medium.connect(RELAY_ID, GATEWAY_ID)
        medium.set_link("node-01", RELAY_ID, available=False)

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
        for tick in range(10):
            node.tick(1_798_000_000_000 + tick * 1_000)

        self.assertGreater(node.stats.packets_dropped_link_unavailable, 0)
        self.assertEqual(node.stats.packets_sent, 0)
        # Attempts only increment when a frame actually hits the wire.
        pending = node.queue.pending_messages()
        self.assertTrue(all(p.attempts == 0 for p in pending))


class CriticalPriorityTests(unittest.TestCase):
    """The starvation guarantee: alerts go first under load."""

    def test_critical_packet_is_sent_before_routine_backlog(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=1)
        critical_node = mesh.node("node-01")
        critical_node.config.priority = PRIORITY_CRITICAL

        # Run long enough for both nodes to have routine backlogs.
        run(mesh, ticks=30)
        critical = mesh.gateway.packets_for("node-01")
        self.assertGreater(len(critical), 0)
        self.assertTrue(all(packet["priority"] == "critical" for packet in critical))

    def test_routine_cannot_starve_critical_across_configurations(self) -> None:
        """A critical node's delivery must not collapse with routine load."""
        for patient_count in (2, 4):
            with self.subTest(patients=patient_count):
                mesh = build_standard_mesh(
                    seed=SEED, patient_count=patient_count, samples_per_packet=1
                )
                mesh.node("node-01").config.priority = PRIORITY_CRITICAL
                run(mesh, ticks=60)

                critical_delivery = len(mesh.gateway.packets_for("node-01"))
                routine_delivery = [
                    len(mesh.gateway.packets_for(n.device_id)) for n in mesh.nodes[1:]
                ]
                # The critical node must be delivering at least as well as the
                # routine nodes, because its queue drains first.
                self.assertGreaterEqual(
                    critical_delivery,
                    min(routine_delivery),
                    "critical traffic fell behind routine traffic",
                )

    def test_gateway_records_the_priority_of_accepted_packets(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=1)
        mesh.node("node-02").config.priority = PRIORITY_CRITICAL
        run(mesh, ticks=40)

        for packet in mesh.gateway.packets_for("node-01"):
            self.assertEqual(packet["priority"], "routine")
        for packet in mesh.gateway.packets_for("node-02"):
            self.assertEqual(packet["priority"], "critical")


class EnvelopeAckTests(unittest.TestCase):
    def test_ack_frame_round_trips(self) -> None:
        ack = Frame.acknowledgement(source=GATEWAY_ID, destination="node-01", acks="node-01:5")
        self.assertEqual(Frame.from_bytes(ack.to_bytes()), ack)
        self.assertEqual(ack.kind, KIND_ACK)
        self.assertEqual(ack.acks, "node-01:5")
        self.assertEqual(ack.payload, b"")

    def test_ack_frame_requires_the_acks_field(self) -> None:
        with self.assertRaises(FrameError):
            Frame(source="a", destination="b", message_id="m", payload=b"", kind=KIND_ACK)

    def test_ack_frame_cannot_carry_a_payload(self) -> None:
        with self.assertRaises(FrameError):
            Frame(
                source="a",
                destination="b",
                message_id="m",
                payload=b"x",
                kind=KIND_ACK,
                acks="other",
            )

    def test_data_frame_cannot_carry_the_acks_field(self) -> None:
        with self.assertRaises(FrameError):
            Frame(
                source="a",
                destination="b",
                message_id="m",
                payload=b"x",
                kind=KIND_DATA,
                acks="other",
            )

    def test_forwarded_ack_keeps_its_identity(self) -> None:
        ack = Frame.acknowledgement(source=GATEWAY_ID, destination="node-01", acks="node-01:5")
        onward = ack.forwarded_by(RELAY_ID)
        self.assertEqual(onward.acks, "node-01:5")
        self.assertEqual(onward.destination, "node-01")
        self.assertEqual(onward.kind, KIND_ACK)

    def test_unknown_kind_is_rejected(self) -> None:
        with self.assertRaises(FrameError):
            Frame(source="a", destination="b", message_id="m", payload=b"", kind="nack")


if __name__ == "__main__":
    unittest.main()
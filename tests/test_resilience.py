"""Phase 4 tests: rerouting, store-and-forward, and recovery correctness.

These assert the resilience claims the project is allowed to make, and the
limits of those claims:

- With an alternate relay, delivery survives primary-relay loss (NFR-03).
- Without one, relay loss is a total outage — stated, not hidden.
- The relay's store-and-forward buffer is bounded, deduplicates retransmissions,
  and backfills without creating duplicate records (FR-05, FR-06).
- Recovery is complete: every packet a node built is eventually stored.

All numbers are simulated (single clock); none are evaluation metrics.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from simulator.sensing.sources import NominalSource, SensorUnavailable  # noqa: E402
from simulator.topology import (  # noqa: E402
    GATEWAY_ID,
    RELAY2_ID,
    RELAY_ID,
    build_standard_mesh,
    run,
)

SEED = 20260928
BASE_MS = 1_798_000_000_000


class DeadSource:
    """A sensor that never produces a reading."""

    def read(self):  # noqa: ANN201
        raise SensorUnavailable("no sensor attached")


class RerouteTests(unittest.TestCase):
    """Alternate-path behaviour when the primary relay disappears."""

    def test_node_reroutes_to_the_alternate_relay(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=1, two_relay=True)
        mesh.medium.set_link("node-01", RELAY_ID, available=False)
        run(mesh, ticks=20)

        node = mesh.node("node-01")
        self.assertGreaterEqual(node.stats.route_changes, 1)
        self.assertEqual(node.active_hop, RELAY2_ID)
        self.assertIsNotNone(node.stats.last_route_change_at_ms)
        # Traffic actually flows through the second relay.
        self.assertGreater(mesh.relay2.stats.received, 0)
        self.assertGreater(len(mesh.gateway.packets_for("node-01")), 0)

    def test_delivery_survives_full_primary_relay_loss(self) -> None:
        """NFR-03: the mesh stays usable when one relay is unavailable."""
        mesh = build_standard_mesh(seed=SEED, patient_count=3, samples_per_packet=2, two_relay=True)
        run(mesh, ticks=10)
        accepted_before = mesh.gateway.stats.packets_accepted

        # Power relay-01 off entirely: every link it had is gone.
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        for node in mesh.nodes:
            mesh.medium.set_link(node.device_id, RELAY_ID, available=False)
        run(mesh, ticks=40)

        self.assertGreater(mesh.gateway.stats.packets_accepted, accepted_before)
        for node in mesh.nodes:
            self.assertGreater(
                len(mesh.gateway.packets_for(node.device_id)),
                0,
                f"{node.device_id} stopped delivering after relay loss",
            )

    def test_single_path_cannot_survive_relay_loss(self) -> None:
        """The honest contrast: no alternate path means a full outage."""
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=2)
        run(mesh, ticks=10)
        accepted_before = mesh.gateway.stats.packets_accepted

        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        for node in mesh.nodes:
            mesh.medium.set_link(node.device_id, RELAY_ID, available=False)
        run(mesh, ticks=20)

        self.assertEqual(
            mesh.gateway.stats.packets_accepted,
            accepted_before,
            "delivery continued without any available path",
        )

    def test_reroute_requires_the_configured_failure_count(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=1, two_relay=True)
        node = mesh.node("node-01")
        node.config.reroute_after_failures = 5
        mesh.medium.set_link("node-01", RELAY_ID, available=False)

        run(mesh, ticks=4)
        self.assertEqual(node.stats.route_changes, 0, "rerouted before the failure threshold")

        run(mesh, ticks=4)
        self.assertEqual(node.stats.route_changes, 1)

    def test_reroute_time_is_recorded_and_bounded(self) -> None:
        """M-05 in miniature: the route change is stamped and prompt."""
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=1, two_relay=True)
        node = mesh.node("node-01")

        for tick in range(5):
            mesh.tick(BASE_MS + tick * 1_000)
        cut_at_ms = BASE_MS + 5 * 1_000
        mesh.medium.set_link("node-01", RELAY_ID, available=False)
        run(mesh, ticks=10, start_at_ms=cut_at_ms)

        change_at = node.stats.last_route_change_at_ms
        self.assertIsNotNone(change_at)
        assert change_at is not None
        self.assertGreater(change_at, cut_at_ms)
        # Default threshold is 2 consecutive failures: one per tick, so the
        # change lands on the second tick after the cut at the latest.
        self.assertLessEqual(change_at - cut_at_ms, 3_000)


class StoreAndForwardTests(unittest.TestCase):
    """Relay buffering across a gateway interruption, and its bounds."""

    def test_relay_buffers_frames_while_the_uplink_is_down(self) -> None:
        mesh = build_standard_mesh(
            seed=SEED, patient_count=2, samples_per_packet=1, relay_buffer_capacity=16
        )
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=10)

        relay = mesh.relay
        self.assertGreater(relay.stats.buffered, 0, "nothing was buffered during the outage")
        self.assertGreater(relay.buffer_depth, 0)
        self.assertEqual(mesh.gateway.stats.packets_accepted, 0)

    def test_backfill_delivers_buffered_frames_exactly_once(self) -> None:
        mesh = build_standard_mesh(
            seed=SEED, patient_count=2, samples_per_packet=1, relay_buffer_capacity=16
        )
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=10)
        buffered = mesh.relay.stats.buffered
        self.assertGreater(buffered, 0)

        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=True)
        run(mesh, ticks=30)

        relay = mesh.relay
        self.assertEqual(relay.buffer_depth, 0, "the buffer did not drain after recovery")
        self.assertEqual(relay.stats.backfilled, buffered, "not every buffered frame was backfilled")
        # Recovery can produce duplicate *deliveries* (the buffered copy and the
        # sender's retransmission overlap) — that is expected. The invariant is
        # that no duplicate *records* are stored.
        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(len(numbers), len(set(numbers)))
            self.assertGreater(len(numbers), 0)

    def test_buffer_is_bounded_and_counts_evictions(self) -> None:
        mesh = build_standard_mesh(
            seed=SEED, patient_count=2, samples_per_packet=1, relay_buffer_capacity=2
        )
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=30)

        relay = mesh.relay
        self.assertLessEqual(relay.buffer_depth, 2)
        self.assertGreater(relay.stats.buffer_dropped, 0, "evictions were not counted")

    def test_retransmissions_do_not_fill_the_buffer_with_duplicates(self) -> None:
        """A sender retrying an unacknowledged message must not crowd the buffer.

        The node retransmits the same message up to its retry budget while the
        gateway is unreachable; the relay keeps one copy.
        """
        mesh = build_standard_mesh(
            seed=SEED,
            patient_count=2,
            samples_per_packet=1,
            relay_buffer_capacity=8,
            sources={"node-02": DeadSource()},
        )
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=6)

        node = mesh.node("node-01")
        self.assertGreater(node.stats.retransmissions, 0, "the scenario did not exercise retries")
        # Two distinct messages were handed over (with retries between); without
        # buffer-side dedup the depth would equal the number of transmissions.
        self.assertEqual(mesh.relay.buffer_depth, 2)

    def test_recovery_is_complete_after_a_gateway_interruption(self) -> None:
        """FR-06/S-03: every packet built during the outage is eventually stored."""
        mesh = build_standard_mesh(
            seed=SEED, patient_count=2, samples_per_packet=2, relay_buffer_capacity=32
        )
        run(mesh, ticks=10)
        accepted_before = mesh.gateway.stats.packets_accepted

        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=20)
        self.assertEqual(mesh.gateway.stats.packets_accepted, accepted_before)
        self.assertGreater(mesh.relay.stats.buffered, 0)

        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=True)
        run(mesh, ticks=60)

        self.assertGreater(mesh.gateway.stats.packets_accepted, accepted_before)
        self.assertEqual(mesh.relay.buffer_depth, 0)
        for node in mesh.nodes:
            built = node.stats.packets_built
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(
                numbers,
                list(range(1, built + 1)),
                f"{node.device_id}: recovery lost or duplicated packets",
            )

    def test_no_buffering_when_disabled(self) -> None:
        """Capacity zero keeps the Phase 3 behaviour: count and drop."""
        mesh = build_standard_mesh(
            seed=SEED, patient_count=2, samples_per_packet=1, relay_buffer_capacity=0
        )
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=10)

        relay = mesh.relay
        self.assertEqual(relay.stats.buffered, 0)
        self.assertEqual(relay.buffer_depth, 0)
        self.assertGreater(relay.stats.dropped_link_unavailable, 0)

    def test_negative_buffer_capacity_is_rejected(self) -> None:
        from simulator.roles import RelayNode
        from simulator.transport import SimulatedMedium

        medium = SimulatedMedium(seed=1)
        medium.register("relay-x")
        medium.register("gateway-x")
        medium.connect("relay-x", "gateway-x")
        with self.assertRaises(ValueError):
            RelayNode(
                relay_id="relay-x",
                next_hop="gateway-x",
                transport=medium.transport("relay-x"),
                buffer_capacity=-1,
            )


class ResilienceUnderFaultsTests(unittest.TestCase):
    """Rerouting and buffering must not corrupt correctness under random faults."""

    def test_two_relay_mesh_with_loss_stays_deduplicated(self) -> None:
        mesh = build_standard_mesh(
            seed=SEED,
            patient_count=3,
            samples_per_packet=2,
            two_relay=True,
            relay_buffer_capacity=32,
            loss_rate=0.2,
            duplication_rate=0.1,
        )
        run(mesh, ticks=80)

        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(len(numbers), len(set(numbers)))
        # Delivery happened despite faults and the single-path topology's loss.
        self.assertGreater(mesh.gateway.stats.packets_accepted, 0)

    def test_alternate_relay_serves_acks_too(self) -> None:
        """After a reroute, acknowledgements must return via the new relay."""
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=1, two_relay=True)
        mesh.medium.set_link("node-01", RELAY_ID, available=False)
        run(mesh, ticks=30)

        node = mesh.node("node-01")
        self.assertGreater(node.stats.packets_acknowledged, 0)
        self.assertGreater(mesh.relay2.stats.received, 0)

    def test_nodes_without_an_alternate_do_not_reroute(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=2, samples_per_packet=1)
        mesh.medium.set_link("node-01", RELAY_ID, available=False)
        run(mesh, ticks=10)

        node = mesh.node("node-01")
        self.assertEqual(node.stats.route_changes, 0)
        self.assertGreater(node.stats.packets_dropped_link_unavailable, 0)


if __name__ == "__main__":
    unittest.main()
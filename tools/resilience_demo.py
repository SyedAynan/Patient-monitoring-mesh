"""Run the Phase 4 failure scenarios and print what was observed.

    python tools/resilience_demo.py

Scenarios follow docs/Evaluation.md (simulated; not evaluation metrics):

- S-02 relay power-off: relay-01 loses every link; nodes must reroute to
  relay-02. Reports reroute time (M-05, in ticks and ms).
- S-03 gateway interruption: the relay's uplink drops while store-and-forward
  buffers frames, then recovers. Reports recovery completeness (M-06) and
  duplicate suppression.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from simulator.topology import (  # noqa: E402
    GATEWAY_ID,
    RELAY_ID,
    build_standard_mesh,
    run,
)

SEED = 20260928
BASE_MS = 1_798_000_000_000
TICK_MS = 1_000


def scenario_relay_power_off() -> None:
    print("S-02 relay power-off (two-relay mesh, reroute enabled)")
    mesh = build_standard_mesh(
        seed=SEED, patient_count=3, samples_per_packet=2, two_relay=True
    )

    run(mesh, ticks=10, start_at_ms=BASE_MS)
    accepted_before = mesh.gateway.stats.packets_accepted

    cut_at_ms = BASE_MS + 10 * TICK_MS
    mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
    for node in mesh.nodes:
        mesh.medium.set_link(node.device_id, RELAY_ID, available=False)
    run(mesh, ticks=40, start_at_ms=cut_at_ms)

    print(f"  accepted before cut: {accepted_before}")
    print(f"  accepted after:      {mesh.gateway.stats.packets_accepted}")
    for node in mesh.nodes:
        change_at = node.stats.last_route_change_at_ms
        reroute_ms = (change_at - cut_at_ms) if change_at else None
        print(
            f"  {node.device_id}: route_changes={node.stats.route_changes} "
            f"reroute_ms={reroute_ms} via={node.active_hop} "
            f"delivered={len(mesh.gateway.packets_for(node.device_id))}"
        )
    print(f"  relay-02 carried: {mesh.relay2.stats.received} frames "
          f"({mesh.relay2.stats.forwarded} forwarded)")
    print("  NOTE: single-path meshes cannot survive this; see tests for the contrast.")


def scenario_gateway_interruption() -> None:
    print("S-03 gateway interruption (store-and-forward enabled)")
    mesh = build_standard_mesh(
        seed=SEED,
        patient_count=3,
        samples_per_packet=2,
        relay_buffer_capacity=32,
    )

    run(mesh, ticks=10, start_at_ms=BASE_MS)
    accepted_before = mesh.gateway.stats.packets_accepted

    mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
    run(mesh, ticks=20, start_at_ms=BASE_MS + 10 * TICK_MS)
    buffered = mesh.relay.stats.buffered
    print(f"  accepted during outage: {mesh.gateway.stats.packets_accepted - accepted_before} "
          f"(local operation only)")
    print(f"  buffered at relay: {buffered} (bound {mesh.relay.buffer_capacity}, "
          f"evicted {mesh.relay.stats.buffer_dropped})")

    mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=True)
    run(mesh, ticks=60, start_at_ms=BASE_MS + 30 * TICK_MS)

    relay = mesh.relay
    print(f"  backfilled: {relay.stats.backfilled}/{buffered} "
          f"(remaining in buffer: {relay.buffer_depth})")
    print(f"  gateway duplicates after recovery: {mesh.gateway.stats.packets_duplicate}")
    for node in mesh.nodes:
        built = node.stats.packets_built
        stored = len(mesh.gateway.sequence_numbers(node.device_id))
        completeness = 100 * stored / built if built else 0.0
        print(f"  {node.device_id}: built={built} stored={stored} completeness={completeness:.0f}%")


def main() -> int:
    print("Phase 4 resilience scenarios (simulated; not evaluation metrics)")
    print(f"seed={SEED} tick=1s\n")
    scenario_relay_power_off()
    print()
    scenario_gateway_interruption()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
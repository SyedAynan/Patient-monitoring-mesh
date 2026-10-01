"""Run the Phase 2 simulated sensing pipeline end to end and print what happened.

    python tools/mesh_demo.py
    python tools/mesh_demo.py --patients 4 --ticks 60 --loss 0.2

This is a demonstration harness, not an experiment: the numbers here come from a
simulated link on one clock and are not evaluation metrics (`docs/Evaluation.md`).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from simulator.topology import build_standard_mesh, run  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patients", type=int, default=3, help="number of sensor nodes (2-5)")
    parser.add_argument("--ticks", type=int, default=40, help="sampling instants to simulate")
    parser.add_argument("--samples-per-packet", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20260928)
    parser.add_argument("--loss", type=float, default=0.0, help="frame loss rate, 0.0-1.0")
    parser.add_argument("--duplication", type=float, default=0.0)
    parser.add_argument("--corruption", type=float, default=0.0)
    parser.add_argument("--reorder", type=float, default=0.0)
    parser.add_argument("--no-relay", action="store_true", help="connect nodes straight to the gateway")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mesh = build_standard_mesh(
        seed=args.seed,
        patient_count=args.patients,
        samples_per_packet=args.samples_per_packet,
        loss_rate=args.loss,
        corruption_rate=args.corruption,
        duplication_rate=args.duplication,
        reorder_rate=args.reorder,
        use_relay=not args.no_relay,
    )
    run(mesh, ticks=args.ticks)

    medium = mesh.medium
    stats = medium.stats
    gateway = mesh.gateway

    print("Phase 2 simulated sensing pipeline (not an evaluation metric)")
    print(f"seed={args.seed} patients={args.patients} ticks={args.ticks} "
          f"samples_per_packet={args.samples_per_packet} relay={'no' if args.no_relay else 'yes'}")
    print()
    print("Topology")
    for node in mesh.nodes:
        print(f"  {node.device_id} ({node.patient_id}, {node.stats.samples_read} samples) "
              f"-> {node.config.next_hop}")
    print(f"  {mesh.relay.relay_id} -> {mesh.relay.next_hop}")
    print()
    print("Sensor and filtering")
    for node in mesh.nodes:
        print(f"  {node.device_id}: samples={node.stats.samples_read} "
              f"unavailable={node.stats.sensor_unavailable} "
              f"implausible={node.stats.implausible_readings} "
              f"windows_skipped={node.stats.windows_skipped}"
              + (f" ({node.stats.last_skip_reason})" if node.stats.last_skip_reason else "")
              + f" quality={node.signal_quality:.2f}")
    print()
    print("Delivery")
    for node in mesh.nodes:
        packets = gateway.packets_for(node.device_id)
        sequences = gateway.sequence_numbers(node.device_id)
        gaps = gateway.missing_sequences(node.device_id)
        print(f"  {node.device_id}: built={node.stats.packets_built} sent={node.stats.packets_sent} "
              f"acknowledged={node.stats.packets_acknowledged} "
              f"retries={node.stats.retransmissions} "
              f"exhausted={node.stats.packets_failed_retry_exhausted} "
              f"accepted={len(packets)} gaps={gaps}")
    print()
    print("Network accounting")
    print(f"  transmitted={stats.transmitted} delivered={stats.delivered} dropped={stats.dropped} "
          f"corrupted={stats.corrupted} duplicated={stats.duplicated} deferred={stats.deferred}")
    print(f"  relay: received={mesh.relay.stats.received} forwarded={mesh.relay.stats.forwarded} "
          f"unroutable={mesh.relay.stats.dropped_unroutable}")
    print(f"  gateway: received={gateway.stats.frames_received} accepted={gateway.stats.packets_accepted} "
          f"duplicates={gateway.stats.packets_duplicate} invalid={gateway.stats.packets_invalid} "
          f"malformed={gateway.stats.frames_malformed}")

    if gateway.received:
        sample = next(iter(gateway.packets_for(mesh.nodes[0].device_id)), None)
        if sample:
            print()
            print("Example accepted packet")
            for key in ("device_id", "patient_id", "sequence_number", "captured_at_ms",
                        "priority", "signal_quality", "measurements"):
                print(f"  {key}: {sample[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
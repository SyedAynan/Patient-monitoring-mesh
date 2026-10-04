"""Phase 8 experiment runner: executes scenarios and records evidence.

    python tools/run_experiments.py                      # full campaign, 5 runs each
    python tools/run_experiments.py --scenarios S-02,S-03 --runs 3
    python tools/run_experiments.py --list

Scenarios follow docs/Evaluation.md. Each run writes, under
`.data/experiments/<session-id>/` (or $APP_DATA_DIR/experiments):

    config.json    exact mesh configuration and seed
    raw.jsonl      one JSON record per observed event (the metrics input)
    summary.json   metrics computed from the raw records by experiment_metrics
    notes.md       anomalies, manual actions, and honest limitations

Session ids are `YYYY-MM-DD-<scenario>-<run>`. Evidence files are written by
the runner and never hand-edited; corrections go in notes.md.

Determinism: run N of a scenario uses seed base_seed + N, so a campaign is
reproducible from its config. The runner observes the mesh by diffing role
stats every tick — it does not reach into internal state beyond the public
stats objects.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from simulator.topology import GATEWAY_ID, RELAY_ID, build_standard_mesh  # noqa: E402
from tools.experiment_metrics import (  # noqa: E402
    SessionEvidence,
    campaign_markdown,
    compute_metrics,
    load_campaign,
)

TICK_MS = 1_000
BASE_AT_MS = 1_798_000_000_000
WARMUP_TICKS = 10


# ---------------------------------------------------------------------------
# Recorder: drives the mesh and observes it tick by tick
# ---------------------------------------------------------------------------

class Recorder:
    """Ticks a mesh, diffs its observable stats, and appends raw records."""

    def __init__(self, mesh, raw_path: Path, session_id: str) -> None:
        self.mesh = mesh
        self.session_id = session_id
        self._raw = raw_path.open("w", encoding="utf-8")
        self._tick = 0
        self._prev = self._snapshot()
        self.notes: list[str] = []

    # -- observation ------------------------------------------------------

    def _snapshot(self) -> dict:
        mesh = self.mesh
        nodes = {
            node.device_id: {
                "next_seq": node.next_sequence_number,
                "retransmissions": node.stats.retransmissions,
                "route_changes": node.stats.route_changes,
                "windows_skipped": node.stats.windows_skipped,
                "last_skip_reason": node.stats.last_skip_reason,
            }
            for node in mesh.nodes
        }
        relays = {
            relay.relay_id: {
                "buffered": relay.stats.buffered,
                "backfilled": relay.stats.backfilled,
                "evicted": relay.stats.buffer_dropped,
                "depth": relay.buffer_depth,
            }
            for relay in mesh.relays()
        }
        gateway = mesh.gateway.stats
        gateway_state = {
            "accepted_count": self.mesh.gateway.stats.packets_accepted,
            "accepted_len": len(self.mesh.gateway.accepted_order),
            "duplicates": gateway.packets_duplicate,
            "malformed": gateway.frames_malformed,
            "invalid": gateway.packets_invalid,
            "frames": gateway.frames_received,
        }
        medium = mesh.medium.stats
        return {
            "nodes": nodes,
            "relays": relays,
            "gateway": gateway_state,
            "medium": {
                "dropped": medium.dropped,
                "corrupted": medium.corrupted,
            },
        }

    def _emit(self, record: dict) -> None:
        record.setdefault("at_ms", self._at_ms())
        self._raw.write(json.dumps(record, sort_keys=True) + "\n")

    def _at_ms(self) -> int:
        return BASE_AT_MS + self._tick * TICK_MS

    # -- driving ----------------------------------------------------------

    def run_ticks(self, ticks: int) -> None:
        """Advance the mesh, observing after every tick."""
        for _ in range(ticks):
            self.mesh.tick(self._at_ms())
            self._tick += 1
            self._observe()

    def phase(self, name: str) -> None:
        self._emit({"kind": "phase", "name": name})

    def cut_link(self, a: str, b: str) -> None:
        self.mesh.medium.set_link(a, b, available=False)
        self._emit({"kind": "link_down", "a": a, "b": b})

    def restore_link(self, a: str, b: str) -> None:
        self.mesh.medium.set_link(a, b, available=True)
        self._emit({"kind": "link_up", "a": a, "b": b})

    def note(self, text: str) -> None:
        self._emit({"kind": "note", "text": text})
        self.notes.append(text)

    def close(self) -> None:
        self._raw.close()

    # -- the per-tick diff --------------------------------------------------

    def _observe(self) -> None:
        current = self._snapshot()
        prev = self._prev
        at_ms = self._at_ms()

        # Emitted: sequence numbers newly queued since the last tick.
        for device_id, node_state in current["nodes"].items():
            prev_node = prev["nodes"][device_id]
            for seq in range(prev_node["next_seq"], node_state["next_seq"]):
                self._emit({"kind": "emitted", "device": device_id, "seq": seq, "at_ms": at_ms})
            if node_state["retransmissions"] > prev_node["retransmissions"]:
                self._emit({
                    "kind": "retry", "device": device_id,
                    "count": node_state["retransmissions"] - prev_node["retransmissions"],
                    "at_ms": at_ms,
                })
            if node_state["route_changes"] > prev_node["route_changes"]:
                self._emit({
                    "kind": "route_change", "device": device_id,
                    "to": self.mesh.node(device_id).active_hop, "at_ms": at_ms,
                })
            if node_state["windows_skipped"] > prev_node["windows_skipped"]:
                self._emit({
                    "kind": "sensor_skip", "device": device_id,
                    "reason": node_state["last_skip_reason"], "at_ms": at_ms,
                })

        # Accepted: new unique packets, straight from the gateway's order log.
        accepted_len_prev = prev["gateway"]["accepted_len"]
        order = self.mesh.gateway.accepted_order
        for device_id, seq in order[accepted_len_prev:]:
            packet = self.mesh.gateway.received[(device_id, seq)]
            self._emit({
                "kind": "accepted", "device": device_id, "seq": seq,
                "priority": packet["priority"],
                "captured_at_ms": packet["captured_at_ms"],
                "at_ms": at_ms,
            })
        for delta_key, kind in (
            ("duplicates", "duplicate"),
            ("malformed", "malformed"),
            ("invalid", "invalid"),
            ("frames", "gateway_frames"),
        ):
            delta = current["gateway"][delta_key] - prev["gateway"][delta_key]
            if delta:
                self._emit({"kind": kind, "count": delta, "at_ms": at_ms})

        for delta_key, kind in (("dropped", "dropped"), ("corrupted", "corrupted")):
            delta = current["medium"][delta_key] - prev["medium"][delta_key]
            if delta:
                self._emit({"kind": kind, "count": delta, "at_ms": at_ms})

        # Relay buffering state: deltas plus a depth sample when non-empty.
        for relay_id, relay_state in current["relays"].items():
            prev_relay = prev["relays"][relay_id]
            if relay_state["buffered"] > prev_relay["buffered"]:
                self._emit({
                    "kind": "buffered", "relay": relay_id,
                    "count": relay_state["buffered"] - prev_relay["buffered"],
                    "at_ms": at_ms,
                })
            if relay_state["backfilled"] > prev_relay["backfilled"]:
                self._emit({
                    "kind": "backfilled", "relay": relay_id,
                    "count": relay_state["backfilled"] - prev_relay["backfilled"],
                    "at_ms": at_ms,
                })
            if relay_state["evicted"] > prev_relay["evicted"]:
                self._emit({
                    "kind": "buffer_evicted", "relay": relay_id,
                    "count": relay_state["evicted"] - prev_relay["evicted"],
                    "at_ms": at_ms,
                })
            if relay_state["depth"] > 0:
                self._emit({
                    "kind": "buffer_depth", "relay": relay_id,
                    "depth": relay_state["depth"], "at_ms": at_ms,
                })

        self._prev = current


# ---------------------------------------------------------------------------
# Scenarios (docs/Evaluation.md section 5)
# ---------------------------------------------------------------------------

def _base_kwargs(**overrides) -> dict:
    """Scenario mesh configuration. Seeds belong to runs, not scenarios:
    the runner injects `base_seed + run` so a campaign is reproducible."""
    kwargs = {
        "patient_count": 5,
        "samples_per_packet": 5,
    }
    kwargs.update(overrides)
    return kwargs


def scenario_s01(mesh, rec: Recorder) -> None:
    """S-01 baseline steady state — reference delivery/latency/throughput."""
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(100)


def scenario_s02(mesh, rec: Recorder) -> None:
    """S-02 relay power-off — route change and reroute time (M-05)."""
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(10)
    # Power relay-01 off entirely.
    rec.cut_link(RELAY_ID, GATEWAY_ID)
    for node in mesh.nodes:
        rec.cut_link(node.device_id, RELAY_ID)
    rec.phase("outage_start")
    rec.run_ticks(40)
    rec.phase("outage_end")


def scenario_s03(mesh, rec: Recorder) -> None:
    """S-03 gateway interruption — buffering, local operation, recovery (M-06)."""
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(10)
    rec.cut_link(RELAY_ID, GATEWAY_ID)
    rec.phase("outage_start")
    rec.run_ticks(20)
    rec.phase("outage_end")
    rec.restore_link(RELAY_ID, GATEWAY_ID)
    rec.run_ticks(60)


def scenario_s04(mesh, rec: Recorder) -> None:
    """S-04 congestion — priority behaviour and throughput.

    FR-01 asks for six nodes; the simulator provides five patient profiles.
    Recorded as a limitation rather than hidden.
    """
    rec.note("FR-01 asks for >=6 nodes; the simulator supports 5 patient profiles.")
    # Force one node to critical priority from the start; patient-04's
    # deteriorating source escalates organically later in the run.
    mesh.node("node-02").config.priority = "critical"
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(160)


def scenario_s05(mesh, rec: Recorder) -> None:
    """S-05 node power loss — that node stops, others continue."""
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(10)
    rec.cut_link("node-01", RELAY_ID)
    rec.phase("outage_start")
    rec.note("node-01 powered off; M-08 (stale display) needs a live dashboard session.")
    rec.run_ticks(40)
    rec.phase("outage_end")
    rec.restore_link("node-01", RELAY_ID)
    rec.run_ticks(20)


def scenario_s06(mesh, rec: Recorder) -> None:
    """S-06 buffer-bound overflow — evictions must be counted, never silent."""
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(10)
    rec.cut_link(RELAY_ID, GATEWAY_ID)
    rec.phase("outage_start")
    rec.run_ticks(40)
    rec.phase("outage_end")
    rec.restore_link(RELAY_ID, GATEWAY_ID)
    rec.run_ticks(30)


def scenario_s07(mesh, rec: Recorder) -> None:
    """S-07 recovery with duplicates and out-of-order arrival — dedup holds."""
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(10)
    rec.cut_link(RELAY_ID, GATEWAY_ID)
    rec.phase("outage_start")
    rec.run_ticks(15)
    rec.phase("outage_end")
    rec.restore_link(RELAY_ID, GATEWAY_ID)
    rec.run_ticks(60)


def scenario_s08(mesh, rec: Recorder) -> None:
    """S-08 extended soak — stability and bounded state over a long window."""
    rec.run_ticks(WARMUP_TICKS)
    rec.phase("warmup_end")
    rec.run_ticks(300)
    depths_ok = all(node.queue_depth <= node.config.queue_capacity for node in mesh.nodes)
    rec.note(f"queue bounds held: {depths_ok}")


SCENARIOS: dict[str, dict] = {
    "S-01": {
        "title": "Baseline steady state",
        "mesh": _base_kwargs(loss_rate=0.0),
        "run": scenario_s01,
    },
    "S-02": {
        "title": "Relay node power-off",
        "mesh": _base_kwargs(two_relay=True),
        "run": scenario_s02,
    },
    "S-03": {
        "title": "Gateway interruption",
        "mesh": _base_kwargs(relay_buffer_capacity=32),
        "run": scenario_s03,
    },
    "S-04": {
        "title": "Congestion and priority (5 nodes, simulator limit)",
        "mesh": _base_kwargs(samples_per_packet=1, loss_rate=0.1, two_relay=True,
                             relay_buffer_capacity=32),
        "run": scenario_s04,
    },
    "S-05": {
        "title": "Node power loss",
        "mesh": _base_kwargs(two_relay=True),
        "run": scenario_s05,
    },
    "S-06": {
        "title": "Buffer-bound overflow",
        "mesh": _base_kwargs(samples_per_packet=1, relay_buffer_capacity=4),
        "run": scenario_s06,
    },
    "S-07": {
        "title": "Recovery with duplicates and reordering",
        "mesh": _base_kwargs(samples_per_packet=1, relay_buffer_capacity=16,
                             loss_rate=0.15, duplication_rate=0.15, reorder_rate=0.1),
        "run": scenario_s07,
    },
    "S-08": {
        "title": "Extended soak run",
        "mesh": _base_kwargs(loss_rate=0.02, relay_buffer_capacity=32, two_relay=True),
        "run": scenario_s08,
    },
}


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def evidence_root() -> Path:
    data_dir = os.environ.get("APP_DATA_DIR", ".data")
    return Path(data_dir) / "experiments"


def run_session(scenario_id: str, run: int, *, base_seed: int, root: Path,
                 date_str: str | None = None) -> Path:
    """Execute one run of one scenario and write its evidence directory."""
    scenario = SCENARIOS[scenario_id]
    seed = base_seed + run
    date_str = date_str or dt.date.today().isoformat()
    session_id = f"{date_str}-{scenario_id}-{run}"
    session_dir = root / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    mesh_kwargs = dict(scenario["mesh"])
    mesh_kwargs["seed"] = seed
    mesh = build_standard_mesh(**mesh_kwargs)

    config = {
        "session_id": session_id,
        "scenario": scenario_id,
        "title": scenario["title"],
        "run": run,
        "seed": seed,
        "base_seed": base_seed,
        "tick_ms": TICK_MS,
        "warmup_ticks": WARMUP_TICKS,
        "base_at_ms": BASE_AT_MS,
        "mesh": {k: v for k, v in mesh_kwargs.items()},
    }
    (session_dir / "config.json").write_text(
        json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    rec = Recorder(mesh, session_dir / "raw.jsonl", session_id)
    scenario["run"](mesh, rec)
    rec.close()

    evidence = SessionEvidence.load(session_dir)
    metrics = compute_metrics(evidence)
    summary = {
        "session_id": session_id,
        "scenario": scenario_id,
        "title": scenario["title"],
        "run": run,
        "seed": seed,
        "metrics": metrics,
        "notes": rec.notes,
    }
    (session_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    notes_md = [
        f"# Notes — {session_id}",
        "",
        f"Scenario: {scenario_id} — {scenario['title']}",
        f"Seed: {seed} (base {base_seed} + run {run})",
        "",
    ]
    if rec.notes:
        notes_md.append("Anomalies / limitations:")
        notes_md.extend(f"- {note}" for note in rec.notes)
    else:
        notes_md.append("No anomalies recorded.")
    notes_md.append("")
    notes_md.append("Records in raw.jsonl are the only source for summary metrics.")
    (session_dir / "notes.md").write_text("\n".join(notes_md), encoding="utf-8")
    return session_dir


def run_campaign(scenario_ids: list[str], *, runs: int, base_seed: int,
                  root: Path, date_str: str | None = None) -> Path:
    """Run every scenario × run, then aggregate and write the campaign report."""
    for scenario_id in scenario_ids:
        for run in range(1, runs + 1):
            session_dir = run_session(
                scenario_id, run, base_seed=base_seed, root=root, date_str=date_str
            )
            print(f"  {session_dir.name}")
    campaign = load_campaign(root)
    campaign_path = root / f"campaign-{date_str or dt.date.today().isoformat()}.md"
    campaign_path.write_text(campaign_markdown(campaign), encoding="utf-8")
    (root / "campaign.json").write_text(
        json.dumps(campaign, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"Campaign report: {campaign_path}")
    return campaign_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenarios", type=str, default="all",
                        help="comma-separated scenario ids, or 'all'")
    parser.add_argument("--runs", type=int, default=5,
                        help="runs per scenario (docs/Evaluation.md asks for >=5)")
    parser.add_argument("--seed", type=int, default=20260928)
    parser.add_argument("--out", type=str, default=None,
                        help="evidence root (default $APP_DATA_DIR/experiments)")
    parser.add_argument("--date", type=str, default=None,
                        help="date string for session ids (default today)")
    parser.add_argument("--list", action="store_true", help="list scenarios and exit")
    args = parser.parse_args()

    if args.list:
        for scenario_id, scenario in SCENARIOS.items():
            print(f"{scenario_id}: {scenario['title']}")
        return 0

    if args.scenarios == "all":
        scenario_ids = sorted(SCENARIOS)
    else:
        scenario_ids = [s.strip() for s in args.scenarios.split(",")]
        unknown = [s for s in scenario_ids if s not in SCENARIOS]
        if unknown:
            parser.error(f"unknown scenarios: {unknown}")

    root = Path(args.out) if args.out else evidence_root()
    print(f"Phase 8 experiment campaign (simulated; single clock)")
    print(f"evidence root: {root}")
    print(f"scenarios: {', '.join(scenario_ids)}  runs each: {args.runs}\n")
    run_campaign(scenario_ids, runs=args.runs, base_seed=args.seed, root=root,
                 date_str=args.date)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

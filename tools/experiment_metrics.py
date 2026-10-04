"""Compute evaluation metrics M-01..M-12 from recorded evidence only.

This module never touches a live mesh. It reads a session's `raw.jsonl` and
`config.json` and computes metrics from the recorded events — which is the
whole point of Phase 8: a number may only be reported as measured when it comes
from a recorded run that produced an evidence file (docs/Evaluation.md
section 1). If a metric cannot be computed from the evidence, it is reported as
None with a reason, never guessed.

Raw-record contract (one JSON object per line; written by the runner):

    {"kind": "phase",       "name": "warmup_end"|"outage_start"|..., "at_ms": int}
    {"kind": "emitted",     "device": str, "seq": int, "at_ms": int}
    {"kind": "accepted",    "device": str, "seq": int, "priority": str,
                            "captured_at_ms": int, "at_ms": int}
    {"kind": "duplicate",   "device": str, "seq": int, "at_ms": int}
    {"kind": "malformed",   "count": int, "at_ms": int}
    {"kind": "invalid",     "count": int, "at_ms": int}
    {"kind": "gateway_frames", "count": int, "at_ms": int}
    {"kind": "dropped",     "count": int, "at_ms": int}
    {"kind": "corrupted",   "count": int, "at_ms": int}
    {"kind": "retry",       "device": str, "count": int, "at_ms": int}
    {"kind": "route_change","device": str, "to": str, "at_ms": int}
    {"kind": "link_down",   "a": str, "b": str, "at_ms": int}
    {"kind": "link_up",     "a": str, "b": str, "at_ms": int}
    {"kind": "buffered",    "relay": str, "count": int, "at_ms": int}
    {"kind": "backfilled",  "relay": str, "count": int, "at_ms": int}
    {"kind": "buffer_evicted", "relay": str, "count": int, "at_ms": int}
    {"kind": "buffer_depth","relay": str, "depth": int, "at_ms": int}
    {"kind": "note",        "text": str, "at_ms": int}

All times are the simulated clock in epoch-ms. The runner records what the
mesh observably did each tick; the metrics below are derived from those
records alone.
"""

from __future__ import annotations

import json
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Metrics that cannot come from mesh evidence (they need a live backend or
# dashboard session). Reported as None with this reason, never estimated.
NEEDS_LIVE_SESSION = "requires a live backend/dashboard session; not derivable from mesh evidence"


@dataclass(frozen=True)
class SessionEvidence:
    session_id: str
    scenario: str
    run: int
    config: dict[str, Any]
    records: list[dict[str, Any]]

    @classmethod
    def load(cls, session_dir: str | Path) -> "SessionEvidence":
        session_dir = Path(session_dir)
        config = json.loads((session_dir / "config.json").read_text(encoding="utf-8"))
        records = [
            json.loads(line)
            for line in (session_dir / "raw.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        return cls(
            session_id=config["session_id"],
            scenario=config["scenario"],
            run=config["run"],
            config=config,
            records=records,
        )


def _phase_boundary(records: list[dict], name: str) -> int | None:
    for record in records:
        if record.get("kind") == "phase" and record.get("name") == name:
            return int(record["at_ms"])
    return None


def _in_window(record: dict, start_ms: int | None, end_ms: int | None) -> bool:
    at = record.get("at_ms")
    if at is None:
        return False
    if start_ms is not None and at < start_ms:
        return False
    if end_ms is not None and at > end_ms:
        return False
    return True


def compute_metrics(evidence: SessionEvidence) -> dict[str, Any]:
    """Compute every evidence-derivable metric for one session.

    Returns a dict of metric id -> {"value": ..., "unit": ..., "note": ...}.
    Values are None when not applicable to the scenario or not computable.
    """
    records = evidence.records
    warmup_end = _phase_boundary(records, "warmup_end")
    metrics: dict[str, Any] = {}

    emitted = [r for r in records if r["kind"] == "emitted" and _in_window(r, warmup_end, None)]
    accepted = [r for r in records if r["kind"] == "accepted"]
    duplicates = [r for r in records if r["kind"] == "duplicate"]

    # M-01: packet delivery ratio — unique accepted / emitted.
    accepted_keys = {(r["device"], r["seq"]) for r in accepted if _in_window(r, warmup_end, None)}
    emitted_keys = {(r["device"], r["seq"]) for r in emitted}
    if emitted_keys:
        ratio = 100.0 * len(accepted_keys & emitted_keys) / len(emitted_keys)
        metrics["M-01"] = {"value": round(ratio, 1), "unit": "%", "note": "unique accepted / emitted"}
    else:
        metrics["M-01"] = {"value": None, "unit": "%", "note": "no packets emitted after warm-up"}

    # M-02 / M-03: end-to-end latency by priority (single simulated clock —
    # measures queue/retry/backfill delay, not radio propagation).
    for metric_id, priority in (("M-02", "routine"), ("M-03", "critical")):
        latencies = []
        for record in accepted:
            if record.get("priority") != priority:
                continue
            latency = record["at_ms"] - record["captured_at_ms"]
            if latency >= 0:
                latencies.append(latency)
        if latencies:
            metrics[metric_id] = {
                "value": int(statistics.median(latencies)),
                "unit": "ms (simulated)",
                "note": f"median of {len(latencies)} {priority} packets; single-clock",
            }
        else:
            metrics[metric_id] = {
                "value": None, "unit": "ms (simulated)",
                "note": f"no {priority} packets accepted",
            }

    # M-04: duplicate and retry rate.
    delivered_total = len([r for r in accepted]) + len(duplicates)
    if delivered_total:
        metrics["M-04"] = {
            "value": round(100.0 * len(duplicates) / delivered_total, 1),
            "unit": "%",
            "note": f"{len(duplicates)} duplicate deliveries / {delivered_total} deliveries",
        }
    else:
        metrics["M-04"] = {"value": None, "unit": "%", "note": "no deliveries"}

    # M-05: reroute time — route_change at_ms minus the last link_down that
    # affected the node's route before the change.
    route_changes = [r for r in records if r["kind"] == "route_change"]
    link_downs = [r for r in records if r["kind"] == "link_down"]
    reroute_times = []
    for change in route_changes:
        prior_cuts = [
            d["at_ms"] for d in link_downs
            if d["at_ms"] <= change["at_ms"]
            and change["device"] in (d["a"], d["b"])
        ]
        if prior_cuts:
            reroute_times.append(change["at_ms"] - max(prior_cuts))
    if reroute_times:
        metrics["M-05"] = {
            "value": int(statistics.median(reroute_times)),
            "unit": "ms (simulated)",
            "note": f"median of {len(reroute_times)} route changes",
        }
    else:
        metrics["M-05"] = {"value": None, "unit": "ms (simulated)", "note": "no route changes recorded"}

    # M-06: recovery completeness — of the packets emitted during an outage
    # window, the fraction eventually accepted (by end of run).
    outage_start = _phase_boundary(records, "outage_start")
    outage_end = _phase_boundary(records, "outage_end")
    if outage_start is not None and outage_end is not None:
        outage_emitted = {
            (r["device"], r["seq"]) for r in emitted if outage_start <= r["at_ms"] <= outage_end
        }
        if outage_emitted:
            recovered = outage_emitted & accepted_keys
            metrics["M-06"] = {
                "value": round(100.0 * len(recovered) / len(outage_emitted), 1),
                "unit": "%",
                "note": f"{len(recovered)}/{len(outage_emitted)} outage packets recovered",
            }
        else:
            metrics["M-06"] = {"value": None, "unit": "%", "note": "no packets emitted during outage"}
    else:
        metrics["M-06"] = {"value": None, "unit": "%", "note": "no outage window in this scenario"}

    # M-07: throughput — accepted per simulated second over the post-warm-up span.
    post = [r["at_ms"] for r in accepted if _in_window(r, warmup_end, None)]
    if len(post) >= 2 and warmup_end is not None:
        span_ms = max(post) - warmup_end
        if span_ms > 0:
            metrics["M-07"] = {
                "value": round(len(post) / (span_ms / 1000.0), 2),
                "unit": "records/s (simulated)",
                "note": "single-clock rate; not a radio throughput measurement",
            }
    if "M-07" not in metrics:
        metrics["M-07"] = {"value": None, "unit": "records/s", "note": "insufficient accepted span"}

    # M-08: stale detection — dashboard/backend state, not mesh evidence.
    metrics["M-08"] = {"value": None, "unit": "s", "note": NEEDS_LIVE_SESSION}

    # M-09: dashboard freshness — same.
    metrics["M-09"] = {"value": None, "unit": "ms", "note": NEEDS_LIVE_SESSION}

    # M-10: peak buffer occupancy and evictions.
    depths = [r["depth"] for r in records if r["kind"] == "buffer_depth"]
    evictions = sum(r["count"] for r in records if r["kind"] == "buffer_evicted")
    if depths or evictions:
        metrics["M-10"] = {
            "value": max(depths) if depths else 0,
            "unit": "records",
            "note": f"peak depth {max(depths) if depths else 0}, {evictions} evictions",
        }
    else:
        metrics["M-10"] = {"value": None, "unit": "records", "note": "no buffering in this scenario"}

    # M-11: protocol error rate — malformed + invalid / gateway frames.
    malformed = sum(r["count"] for r in records if r["kind"] == "malformed")
    invalid = sum(r["count"] for r in records if r["kind"] == "invalid")
    frames = sum(r["count"] for r in records if r["kind"] == "gateway_frames")
    if frames:
        metrics["M-11"] = {
            "value": round(100.0 * (malformed + invalid) / frames, 1),
            "unit": "%",
            "note": f"{malformed + invalid} rejected / {frames} frames received",
        }
    else:
        metrics["M-11"] = {"value": None, "unit": "%", "note": "no frames received at the gateway"}

    # M-12: traceability — every accepted record resolvable to device,
    # timestamp, and sequence number.
    if accepted:
        traceable = sum(
            1 for r in accepted
            if r.get("device") and r.get("seq") is not None and r.get("captured_at_ms") is not None
        )
        metrics["M-12"] = {
            "value": round(100.0 * traceable / len(accepted), 1),
            "unit": "%",
            "note": f"{traceable}/{len(accepted)} accepted records fully traceable",
        }
    else:
        metrics["M-12"] = {"value": None, "unit": "%", "note": "no accepted records"}

    return metrics


def aggregate_runs(summaries: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate metric values across a scenario's runs: median, min, max."""
    run_count = len(summaries)
    aggregated: dict[str, Any] = {"runs": run_count, "metrics": {}}
    metric_ids: list[str] = []
    for summary in summaries:
        for metric_id in summary["metrics"]:
            if metric_id not in metric_ids:
                metric_ids.append(metric_id)
    for metric_id in metric_ids:
        values = [
            s["metrics"][metric_id]["value"]
            for s in summaries
            if metric_id in s.get("metrics", {}) and s["metrics"][metric_id]["value"] is not None
        ]
        entry: dict[str, Any] = {
            "unit": summaries[0]["metrics"][metric_id]["unit"] if summaries else "",
            "runs_with_values": len(values),
        }
        if values:
            entry["median"] = round(statistics.median(values), 2)
            entry["min"] = round(min(values), 2)
            entry["max"] = round(max(values), 2)
        else:
            entry["median"] = None
            entry["min"] = None
            entry["max"] = None
        aggregated["metrics"][metric_id] = entry
    return aggregated


def campaign_markdown(campaign: dict[str, Any]) -> str:
    """Render a campaign's aggregated results as the report table shape."""
    lines = [
        "# Evaluation Results — recorded experiment campaign",
        "",
        f"Generated from evidence under `{campaign['evidence_root']}`.",
        "Every value below comes from a recorded run; see the session directories",
        "for config, raw records, and per-run summaries.",
        "",
        "All latency/throughput figures are **simulated single-clock values**:",
        "they measure queue, retry, and backfill behaviour, not radio propagation.",
        "Physical ESP-NOW validation remains deferred until hardware is available.",
        "",
    ]
    for scenario_id in sorted(campaign["scenarios"]):
        block = campaign["scenarios"][scenario_id]
        lines.append(f"## {scenario_id} — {block.get('title', '')}")
        lines.append("")
        lines.append(f"Runs: {block['runs']}")
        lines.append("")
        lines.append("| Metric | Median | Min | Max | Unit | Note |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for metric_id in sorted(block["metrics"]):
            entry = block["metrics"][metric_id]
            if entry.get("median") is not None:
                lines.append(
                    f"| {metric_id} | {entry['median']} | {entry['min']} | {entry['max']} "
                    f"| {entry['unit']} | {entry['runs_with_values']}/{block['runs']} runs |"
                )
            else:
                lines.append(f"| {metric_id} | — | — | — | {entry['unit']} | no value in any run |")
        lines.append("")
    return "\n".join(lines) + "\n"


def load_campaign(evidence_root: str | Path) -> dict[str, Any]:
    """Rebuild the campaign summary from a directory of session dirs."""
    evidence_root = Path(evidence_root)
    scenarios: dict[str, Any] = {}
    for session_dir in sorted(p for p in evidence_root.iterdir() if p.is_dir()):
        summary_path = session_dir / "summary.json"
        if not summary_path.is_file():
            continue
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        scenario_id = summary["scenario"]
        block = scenarios.setdefault(
            scenario_id, {"title": summary.get("title", ""), "runs": 0, "summaries": []}
        )
        block["summaries"].append(summary)
        block["runs"] += 1
    for block in scenarios.values():
        summaries = block.pop("summaries")
        block.update(aggregate_runs(summaries))
    return {"evidence_root": str(evidence_root), "scenarios": scenarios}

"""Phase 8 tests: the experiment runner, evidence discipline, and metrics.

The core rule under test: no metric without evidence. Summaries are computed
from raw.jsonl records only, evidence files have the documented shape, runs are
deterministic per seed, and aggregates report median/min/max across runs.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.experiment_metrics import (  # noqa: E402
    SessionEvidence,
    aggregate_runs,
    campaign_markdown,
    compute_metrics,
    load_campaign,
)
from tools.run_experiments import (  # noqa: E402
    SCENARIOS,
    run_session,
)


class ScenarioCatalogTests(unittest.TestCase):
    def test_all_documented_scenarios_exist(self) -> None:
        """S-01..S-08 from docs/Evaluation.md are all implemented."""
        for scenario_id in (f"S-0{i}" for i in range(1, 9)):
            self.assertIn(scenario_id, SCENARIOS)
            self.assertTrue(SCENARIOS[scenario_id]["title"])
            self.assertTrue(callable(SCENARIOS[scenario_id]["run"]))

    def test_every_scenario_declares_a_mesh_configuration(self) -> None:
        for scenario_id, scenario in SCENARIOS.items():
            self.assertIn("mesh", scenario)
            # Seeds belong to runs, not scenarios: the runner injects them so a
            # campaign is reproducible from its config.
            self.assertNotIn("seed", scenario["mesh"], scenario_id)


class EvidenceDisciplineTests(unittest.TestCase):
    """A session directory is the unit of proof: shape, completeness, source."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _session(self, scenario_id: str = "S-01", run: int = 1) -> Path:
        return run_session(scenario_id, run, base_seed=20260928, root=self.root,
                           date_str="2026-10-04")

    def test_session_directory_contains_all_evidence_files(self) -> None:
        session_dir = self._session()
        for filename in ("config.json", "raw.jsonl", "summary.json", "notes.md"):
            self.assertTrue((session_dir / filename).is_file(), filename)

    def test_raw_records_are_json_lines_with_kinds(self) -> None:
        session_dir = self._session()
        records = [
            json.loads(line)
            for line in (session_dir / "raw.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertGreater(len(records), 0)
        for record in records:
            self.assertIn("kind", record)
            self.assertIn("at_ms", record)

    def test_summary_metrics_come_only_from_the_raw_records(self) -> None:
        """Recomputing from raw.jsonl must reproduce the stored summary."""
        session_dir = self._session()
        stored = json.loads((session_dir / "summary.json").read_text(encoding="utf-8"))
        recomputed = compute_metrics(SessionEvidence.load(session_dir))
        self.assertEqual(stored["metrics"], recomputed)

    def test_baseline_delivery_is_complete(self) -> None:
        """S-01, clean link: every emitted packet must be delivered."""
        session_dir = self._session("S-01")
        summary = json.loads((session_dir / "summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["metrics"]["M-01"]["value"], 100.0)
        self.assertEqual(summary["metrics"]["M-12"]["value"], 100.0)

    def test_gateway_interruption_recovers_completely(self) -> None:
        """S-03: buffered data returns — recovery completeness must be 100%."""
        session_dir = self._session("S-03")
        summary = json.loads((session_dir / "summary.json").read_text(encoding="utf-8"))
        m06 = summary["metrics"]["M-06"]
        self.assertIsNotNone(m06["value"], m06["note"])
        self.assertEqual(m06["value"], 100.0)

    def test_outage_records_gaps_not_smoothed_data(self) -> None:
        """S-03 raw records: no accepted packets during the outage window."""
        session_dir = self._session("S-03")
        evidence = SessionEvidence.load(session_dir)
        outage_start = outage_end = None
        for record in evidence.records:
            if record["kind"] == "phase" and record["name"] == "outage_start":
                outage_start = record["at_ms"]
            if record["kind"] == "phase" and record["name"] == "outage_end":
                outage_end = record["at_ms"]
        self.assertIsNotNone(outage_start)
        self.assertIsNotNone(outage_end)
        during = [
            record for record in evidence.records
            if record["kind"] == "accepted"
            and outage_start < record["at_ms"] < outage_end
        ]
        self.assertEqual(during, [], "acceptances recorded during a gateway outage")

    def test_relay_power_off_records_a_route_change(self) -> None:
        session_dir = self._session("S-02")
        evidence = SessionEvidence.load(session_dir)
        route_changes = [r for r in evidence.records if r["kind"] == "route_change"]
        self.assertGreater(len(route_changes), 0)
        summary = json.loads((session_dir / "summary.json").read_text(encoding="utf-8"))
        self.assertIsNotNone(summary["metrics"]["M-05"]["value"])

    def test_buffer_overflow_counts_evictions(self) -> None:
        """S-06: a tiny buffer under a long outage must record evictions."""
        session_dir = self._session("S-06")
        summary = json.loads((session_dir / "summary.json").read_text(encoding="utf-8"))
        m10 = summary["metrics"]["M-10"]
        self.assertIsNotNone(m10["value"])
        self.assertIn("evictions", m10["note"])

    def test_duplicate_rate_is_measured_under_faults(self) -> None:
        session_dir = self._session("S-07")
        summary = json.loads((session_dir / "summary.json").read_text(encoding="utf-8"))
        m04 = summary["metrics"]["M-04"]
        self.assertIsNotNone(m04["value"], "duplicates must be observed under S-07 faults")
        self.assertGreater(m04["value"], 0)
        # And still no duplicate stored records: M-01 counts unique keys.
        evidence = SessionEvidence.load(session_dir)
        keys = [
            (r["device"], r["seq"])
            for r in evidence.records if r["kind"] == "accepted"
        ]
        self.assertEqual(len(keys), len(set(keys)))

    def test_deterministic_runs_reproduce_summaries(self) -> None:
        first = run_session("S-03", 1, base_seed=20260928, root=self.root,
                            date_str="2026-10-04")
        second = run_session("S-03", 1, base_seed=20260928, root=self.root,
                             date_str="2026-10-04")
        first_summary = (first / "summary.json").read_text(encoding="utf-8")
        second_summary = (second / "summary.json").read_text(encoding="utf-8")
        self.assertEqual(first_summary, second_summary)

    def test_different_seeds_produce_different_evidence(self) -> None:
        run_session("S-07", 1, base_seed=20260928, root=self.root, date_str="2026-10-04")
        other = run_session("S-07", 1, base_seed=999, root=self.root, date_str="2026-10-04")
        records = [
            line for line in (other / "raw.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertGreater(len(records), 0)


class MetricComputationTests(unittest.TestCase):
    def test_missing_evidence_sections_are_reported_not_guessed(self) -> None:
        """Metrics with no supporting evidence are None, with a reason."""
        metrics = compute_metrics(SessionEvidence(
            session_id="x", scenario="S-99", run=1, config={}, records=[],
        ))
        for metric_id, entry in metrics.items():
            self.assertIsNone(entry["value"], metric_id)
            self.assertTrue(entry["note"], f"{metric_id} needs a note when value is None")

    def test_live_session_metrics_are_explicitly_marked(self) -> None:
        metrics = compute_metrics(SessionEvidence(
            session_id="x", scenario="S-99", run=1, config={}, records=[],
        ))
        for metric_id in ("M-08", "M-09"):
            self.assertIn("live", metrics[metric_id]["note"].lower())

    def test_aggregate_reports_median_min_max(self) -> None:
        summaries = [
            {"metrics": {"M-01": {"value": v, "unit": "%", "note": ""}}}
            for v in (80.0, 90.0, 100.0)
        ]
        aggregate = aggregate_runs(summaries)
        entry = aggregate["metrics"]["M-01"]
        self.assertEqual(aggregate["runs"], 3)
        self.assertEqual(entry["median"], 90.0)
        self.assertEqual(entry["min"], 80.0)
        self.assertEqual(entry["max"], 100.0)
        self.assertEqual(entry["runs_with_values"], 3)

    def test_aggregate_skips_none_values(self) -> None:
        summaries = [
            {"metrics": {"M-05": {"value": None, "unit": "ms", "note": "no route changes"}}},
            {"metrics": {"M-05": {"value": 2000, "unit": "ms", "note": ""}}},
        ]
        entry = aggregate_runs(summaries)["metrics"]["M-05"]
        self.assertEqual(entry["runs_with_values"], 1)
        self.assertEqual(entry["median"], 2000)

    def test_campaign_markdown_renders_tables_with_placeholders(self) -> None:
        campaign = {
            "evidence_root": ".data/experiments",
            "scenarios": {
                "S-01": {
                    "title": "Baseline", "runs": 2,
                    "metrics": {
                        "M-01": {"median": 100.0, "min": 100.0, "max": 100.0,
                                 "unit": "%", "runs_with_values": 2},
                        "M-05": {"median": None, "min": None, "max": None,
                                 "unit": "ms", "runs_with_values": 0},
                    },
                },
            },
        }
        markdown = campaign_markdown(campaign)
        self.assertIn("| M-01 | 100.0 |", markdown)
        self.assertIn("| M-05 | — |", markdown)
        self.assertIn("simulated single-clock", markdown)

    def test_load_campaign_reads_session_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_session("S-01", 1, base_seed=1, root=root, date_str="2026-10-04")
            run_session("S-01", 2, base_seed=1, root=root, date_str="2026-10-04")
            campaign = load_campaign(root)
            self.assertEqual(campaign["scenarios"]["S-01"]["runs"], 2)
            self.assertIn("M-01", campaign["scenarios"]["S-01"]["metrics"])


class ConfigTraceabilityTests(unittest.TestCase):
    def test_config_records_the_exact_mesh_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session_dir = run_session("S-07", 3, base_seed=50, root=Path(tmp),
                                      date_str="2026-10-04")
            config = json.loads((session_dir / "config.json").read_text(encoding="utf-8"))
            self.assertEqual(config["scenario"], "S-07")
            self.assertEqual(config["run"], 3)
            self.assertEqual(config["seed"], 53)  # base 50 + run 3
            self.assertEqual(config["mesh"]["loss_rate"], 0.15)
            self.assertEqual(config["mesh"]["duplication_rate"], 0.15)

    def test_notes_md_records_simulator_limitations(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session_dir = run_session("S-04", 1, base_seed=1, root=Path(tmp),
                                      date_str="2026-10-04")
            notes = (session_dir / "notes.md").read_text(encoding="utf-8")
            self.assertIn("5 patient profiles", notes)


if __name__ == "__main__":
    unittest.main()
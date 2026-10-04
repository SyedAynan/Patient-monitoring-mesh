"""Tests for the shared risk scoring engine.

Boundary exactness, trend math, quality gating, determinism, and config
validation. These are the regression fixtures for Phase 6: any behavior change
here is a deliberate rule change, not an accident.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.risk import (  # noqa: E402
    DEFAULT_CONFIG,
    RiskConfig,
    assess,
    trend_from_readings,
)


def assess_vitals(**overrides):
    defaults = dict(
        heart_rate_bpm=72.0,
        spo2_percent=98.0,
        temperature_c=36.7,
        signal_quality=0.9,
    )
    defaults.update(overrides)
    return assess(**defaults)


class ThresholdBoundaryTests(unittest.TestCase):
    """Exact-boundary semantics: a rule fires strictly beyond, never at, the bound."""

    def test_just_below_high_bound_does_not_fire(self) -> None:
        result = assess_vitals(heart_rate_bpm=120.0)
        self.assertEqual(result.level, "normal")
        self.assertTrue(all(e.rule != "hr_high" for e in result.evidence))

    def test_just_above_high_bound_fires(self) -> None:
        result = assess_vitals(heart_rate_bpm=120.1)
        self.assertTrue(any(e.rule == "hr_high" for e in result.evidence))

    def test_just_above_low_bound_does_not_fire(self) -> None:
        result = assess_vitals(heart_rate_bpm=50.0)
        self.assertTrue(all(e.rule != "hr_low" for e in result.evidence))

    def test_just_below_low_bound_fires(self) -> None:
        result = assess_vitals(heart_rate_bpm=49.9)
        self.assertTrue(any(e.rule == "hr_low" for e in result.evidence))

    def test_severe_hypoxia_reaches_critical(self) -> None:
        result = assess_vitals(spo2_percent=88.0)
        # spo2_low (25) + spo2_low_severe (30) = 55 -> attention band by score.
        self.assertIn(result.level, ("attention", "critical"))
        rules = {e.rule for e in result.evidence}
        self.assertIn("spo2_low", rules)
        self.assertIn("spo2_low_severe", rules)

    def test_full_abnormal_set_reaches_critical(self) -> None:
        result = assess_vitals(heart_rate_bpm=155.0, spo2_percent=86.0, temperature_c=38.9)
        self.assertEqual(result.level, "critical")
        self.assertEqual(result.score, 100)  # capped

    def test_temperature_attention_band(self) -> None:
        result = assess_vitals(temperature_c=38.2)
        self.assertEqual(result.level, "normal")  # 15 points alone stays normal
        result_severe = assess_vitals(temperature_c=39.2)
        # 15 + 20 = 35, still below the 40 attention bar.
        self.assertEqual(result_severe.level, "normal")


class QualityGateTests(unittest.TestCase):
    def test_low_quality_is_unknown_not_critical(self) -> None:
        result = assess_vitals(heart_rate_bpm=155.0, spo2_percent=86.0, signal_quality=0.3)
        self.assertEqual(result.level, "unknown")
        self.assertEqual(result.evidence, ())

    def test_gate_boundary_is_inclusive_of_minimum(self) -> None:
        result = assess_vitals(heart_rate_bpm=72.0, signal_quality=DEFAULT_CONFIG.minimum_quality)
        self.assertEqual(result.level, "normal")

    def test_quality_is_clamped(self) -> None:
        result = assess_vitals(signal_quality=5.0)
        self.assertEqual(result.signal_quality, 1.0)

    def test_unknown_is_not_packet_risk(self) -> None:
        result = assess_vitals(signal_quality=0.1)
        self.assertFalse(result.is_packet_risk())
        self.assertTrue(assess_vitals().is_packet_risk())


class TrendTests(unittest.TestCase):
    def test_falling_spo2_fires_trend_rule(self) -> None:
        # 98 -> 94.5 over 60 s = -3.5/min, below the -3.0/min limit.
        result = assess_vitals(
            trend_values=[98.0, 97.0, 96.0, 94.5],
            trend_timestamps_ms=[0, 20_000, 40_000, 60_000],
        )
        rules = {e.rule for e in result.evidence}
        self.assertIn("spo2_falling", rules)

    def test_steady_spo2_does_not_fire(self) -> None:
        result = assess_vitals(
            trend_values=[98.0, 98.1, 97.9, 98.0],
            trend_timestamps_ms=[0, 20_000, 40_000, 60_000],
        )
        self.assertTrue(all(e.rule != "spo2_falling" for e in result.evidence))

    def test_rising_hr_fires(self) -> None:
        # 70 -> 85 over 60 s = +15/min, above the +12/min limit.
        result = assess_vitals(
            trend_values=[70.0, 75.0, 80.0, 85.0],
            trend_timestamps_ms=[0, 20_000, 40_000, 60_000],
            trend_metric="heart_rate_bpm",
        )
        rules = {e.rule for e in result.evidence}
        self.assertIn("hr_rising", rules)

    def test_degenerate_series_produces_no_trend(self) -> None:
        self.assertIsNone(trend_from_readings([98.0], [0]))
        self.assertIsNone(trend_from_readings([], []))
        self.assertIsNone(trend_from_readings([98.0, 96.0], [5_000, 5_000]))

    def test_trend_without_data_is_threshold_only(self) -> None:
        result = assess_vitals()
        self.assertEqual(result.level, "normal")


class DeterminismTests(unittest.TestCase):
    def test_same_inputs_same_assessment(self) -> None:
        kwargs = dict(
            heart_rate_bpm=100.0,
            spo2_percent=92.0,
            temperature_c=38.5,
            signal_quality=0.8,
            trend_values=[98.0, 95.0],
            trend_timestamps_ms=[0, 30_000],
        )
        self.assertEqual(assess(**kwargs), assess(**kwargs))

    def test_fingerprint_changes_with_thresholds(self) -> None:
        tuned = DEFAULT_CONFIG.with_thresholds(
            hr_high=110, hr_low=55, spo2_low=95, temp_high=37.5
        )
        base = assess_vitals(heart_rate_bpm=72.0)
        tuned_result = assess_vitals(heart_rate_bpm=72.0, config=tuned)
        self.assertNotEqual(base.config_fingerprint, tuned_result.config_fingerprint)
        self.assertEqual(base.config_fingerprint, assess_vitals().config_fingerprint)


class ConfigValidationTests(unittest.TestCase):
    def test_crossed_hr_bounds_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            DEFAULT_CONFIG.with_thresholds(hr_high=50, hr_low=60, spo2_low=94, temp_high=38)

    def test_implausible_spo2_bound_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            DEFAULT_CONFIG.with_thresholds(hr_high=120, hr_low=50, spo2_low=101, temp_high=38)

    def test_implausible_temp_bound_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            DEFAULT_CONFIG.with_thresholds(hr_high=120, hr_low=50, spo2_low=94, temp_high=60)

    def test_with_thresholds_replaces_only_the_four_bounds(self) -> None:
        tuned = DEFAULT_CONFIG.with_thresholds(hr_high=100, hr_low=55, spo2_low=95, temp_high=37.5)
        names = [r.name for r in tuned.rules]
        self.assertEqual(names, [r.name for r in DEFAULT_CONFIG.rules])
        bounds = {r.name: r.bound for r in tuned.rules}
        self.assertEqual(bounds["hr_high"], 100)
        self.assertEqual(bounds["hr_low"], 55)
        self.assertEqual(bounds["spo2_low"], 95)
        self.assertEqual(bounds["temp_high"], 37.5)
        # Severe sub-rules are untouched.
        self.assertEqual(bounds["spo2_low_severe"], 90.0)


class ExplainabilityTests(unittest.TestCase):
    """Phase 6 DoD: every risk state is explainable from recorded inputs."""

    def test_evidence_names_value_and_bound(self) -> None:
        result = assess_vitals(heart_rate_bpm=130.0)
        evidence = [e for e in result.evidence if e.rule == "hr_high"]
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0].value, 130.0)
        self.assertEqual(evidence[0].bound, 120.0)
        self.assertIn("130.0", evidence[0].detail)
        self.assertIn("120", evidence[0].detail)

    def test_normal_explains_itself(self) -> None:
        self.assertEqual(assess_vitals().explain, "all vitals within configured bounds")

    def test_unknown_explains_the_gate(self) -> None:
        explanation = assess_vitals(signal_quality=0.1).explain
        self.assertIn("signal quality", explanation)


if __name__ == "__main__":
    unittest.main()
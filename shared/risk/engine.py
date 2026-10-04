"""The risk scoring engine: rules, evidence, and the assessment API.

Structure:

- `ThresholdRule` — one vital crossing a bound (e.g. HR above 120 bpm).
- `TrendRule` — a vital moving fast in a dangerous direction over a short
  window (e.g. SpO₂ dropping more than 3 points in 60 s).
- `RiskConfig` — every threshold, window, and weight, so behavior is fully
  configurable and every change is visible in the config endpoint.
- `assess()` — run the rules, collect the evidence, sum the points, map the
  score to a level, gate on signal quality.

Design rules (from docs/Rules.md and the Phase 6 DoD):

- Deterministic: same inputs + same config → same assessment, byte for byte.
- Explainable: `evidence` lists every fired rule with value and threshold.
- Quality-gated: a poor signal cannot produce a "critical" claim; it produces
  "unknown" with the quality as the reason. Never guess confidence.
- Bounded: scores and windows are clamped; no rule can emit an unbounded value.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field, replace
from typing import Sequence

RiskLevel = str  # "normal" | "attention" | "critical" | "unknown"
RISK_LEVELS = ("normal", "attention", "critical", "unknown")

# Level cut-offs on the 0–100 score. Deliberately plain: attention before 40,
# critical from 70. Tuning belongs to the config, not to hidden constants here.
_ATTENTION_SCORE = 40
_CRITICAL_SCORE = 70

# Minimum signal quality for any non-"unknown" verdict.
MINIMUM_QUALITY_FOR_ASSESSMENT = 0.4


@dataclass(frozen=True)
class ThresholdRule:
    """A vital crossing a bound. Points are awarded when the bound is crossed."""

    name: str
    metric: str
    bound: float
    direction: str  # "above" | "below"
    points: int
    level_hint: str  # "critical" when this rule alone should demand attention

    def evaluate(self, value: float) -> bool:
        if self.direction == "above":
            return value > self.bound
        return value < self.bound


@dataclass(frozen=True)
class TrendRule:
    """A vital moving fast in a dangerous direction over `window_seconds`.

    `per_minute` is the signed rate-of-change threshold: a negative value means
    "falling faster than |per_minute| per minute is dangerous".
    """

    name: str
    metric: str
    per_minute: float  # signed: negative = falling is dangerous
    window_seconds: int
    points: int

    def rate(self, first: float, last: float, elapsed_seconds: float) -> float:
        """Signed per-minute rate of change; 0.0 when elapsed is unusable."""
        if elapsed_seconds <= 0:
            return 0.0
        return (last - first) / elapsed_seconds * 60.0

    def evaluate(self, rate_per_minute: float) -> bool:
        if self.per_minute < 0:
            return rate_per_minute < self.per_minute
        return rate_per_minute > self.per_minute


@dataclass(frozen=True)
class RiskConfig:
    """Every number the scorer uses. Defaults are round demo numbers, not evidence."""

    rules: tuple[ThresholdRule, ...]
    trend_rules: tuple[TrendRule, ...]
    minimum_quality: float = MINIMUM_QUALITY_FOR_ASSESSMENT
    attention_score: int = _ATTENTION_SCORE
    critical_score: int = _CRITICAL_SCORE

    def with_thresholds(
        self, *, hr_high: float, hr_low: float, spo2_low: float, temp_high: float
    ) -> "RiskConfig":
        """Return a config with the four main bounds replaced (validated).

        Used by the backend's PUT /risk/config so an operator can tune the demo
        without constructing rules by hand.
        """
        if hr_low >= hr_high:
            raise ValueError("hr_low must be below hr_high")
        if not 0.0 < spo2_low <= 100.0:
            raise ValueError("spo2_low must be within (0, 100]")
        if not 30.0 < temp_high < 45.0:
            raise ValueError("temp_high must be a plausible body temperature bound")

        updated: list[ThresholdRule] = []
        replacements = {
            "hr_high": hr_high,
            "hr_low": hr_low,
            "spo2_low": spo2_low,
            "temp_high": temp_high,
        }
        for rule in self.rules:
            if rule.name in replacements:
                updated.append(replace(rule, bound=replacements[rule.name]))
            else:
                updated.append(rule)
        return replace(self, rules=tuple(updated))


@dataclass(frozen=True)
class RiskRuleResult:
    """One fired rule and the values that tripped it — the evidence entry."""

    rule: str
    metric: str
    value: float
    bound: float
    direction: str
    points: int
    detail: str


@dataclass(frozen=True)
class RiskAssessment:
    """The verdict for one patient at one moment, fully explained."""

    level: RiskLevel
    score: int
    evidence: tuple[RiskRuleResult, ...]
    config_fingerprint: str
    signal_quality: float
    assessed_at_ms: int

    @property
    def explain(self) -> str:
        """One-line human-readable explanation built from the evidence."""
        if self.level == "unknown":
            return f"signal quality {self.signal_quality:.2f} is below the assessment gate"
        if not self.evidence:
            return "all vitals within configured bounds"
        parts = [f"{e.rule}: {e.detail}" for e in self.evidence]
        return "; ".join(parts)

    def is_packet_risk(self) -> bool:
        """True when this assessment belongs in a packet's risk block.

        "unknown" never goes on the wire: an un-gateable assessment is a display
        concern, not telemetry. The packet contract's risk levels are
        normal/attention/critical only.
        """
        return self.level in ("normal", "attention", "critical")


# ---------------------------------------------------------------------------
# Default rule set
# ---------------------------------------------------------------------------

_DEFAULT_RULES: tuple[ThresholdRule, ...] = (
    ThresholdRule("hr_high", "heart_rate_bpm", 120.0, "above", 30, "critical"),
    ThresholdRule("hr_low", "heart_rate_bpm", 50.0, "below", 30, "critical"),
    ThresholdRule("spo2_low", "spo2_percent", 94.0, "below", 25, "critical"),
    ThresholdRule("spo2_low_severe", "spo2_percent", 90.0, "below", 30, "critical"),
    ThresholdRule("temp_high", "temperature_c", 38.0, "above", 15, "attention"),
    ThresholdRule("temp_high_severe", "temperature_c", 39.0, "above", 20, "attention"),
)

_DEFAULT_TREND_RULES: tuple[TrendRule, ...] = (
    TrendRule("spo2_falling", "spo2_percent", -3.0, 60, 20),
    TrendRule("hr_rising", "heart_rate_bpm", 12.0, 60, 15),
)

DEFAULT_CONFIG = RiskConfig(
    rules=_DEFAULT_RULES,
    trend_rules=_DEFAULT_TREND_RULES,
)


# ---------------------------------------------------------------------------
# Trend input
# ---------------------------------------------------------------------------

def trend_from_readings(
    values: Sequence[float],
    timestamps_ms: Sequence[int],
) -> tuple[float, float, float] | None:
    """First value, last value, and elapsed seconds for a series.

    Returns None when there are fewer than two points or the series does not
    span a usable positive duration — a trend needs two points and real time
    between them, and a degenerate window must not produce a fake rate.
    """
    if len(values) != len(timestamps_ms) or len(values) < 2:
        return None
    elapsed_ms = timestamps_ms[-1] - timestamps_ms[0]
    if elapsed_ms <= 0:
        return None
    return (float(values[0]), float(values[-1]), elapsed_ms / 1000.0)


# ---------------------------------------------------------------------------
# Assessment
# ---------------------------------------------------------------------------

def _fingerprint(config: RiskConfig) -> str:
    """Stable identity for a config, so stored assessments name their rules.

    A short deterministic digest of the rule bounds and weights: any threshold
    change changes the fingerprint, which is what makes a stored risk snapshot
    interpretable later ("which rules were these?").
    """
    import hashlib
    import json

    payload = json.dumps(
        {
            "rules": [
                [r.name, r.metric, r.bound, r.direction, r.points]
                for r in config.rules
            ],
            "trend_rules": [
                [t.name, t.metric, t.per_minute, t.window_seconds, t.points]
                for t in config.trend_rules
            ],
            "minimum_quality": config.minimum_quality,
            "attention_score": config.attention_score,
            "critical_score": config.critical_score,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def assess(
    *,
    heart_rate_bpm: float,
    spo2_percent: float,
    temperature_c: float,
    signal_quality: float,
    trend_values: Sequence[float] | None = None,
    trend_timestamps_ms: Sequence[int] | None = None,
    trend_metric: str = "spo2_percent",
    config: RiskConfig = DEFAULT_CONFIG,
    assessed_at_ms: int = 0,
) -> RiskAssessment:
    """Score one moment. Deterministic; evidence lists every fired rule.

    Trend rules run only when a `trend_metric`-matched series is supplied;
    without trend data the assessment is threshold-only, which is correct for a
    node that just booted. Quality gating is absolute: below the gate the level
    is "unknown" and no evidence is claimed.
    """
    quality = min(1.0, max(0.0, float(signal_quality)))
    fingerprint = _fingerprint(config)

    if quality < config.minimum_quality:
        return RiskAssessment(
            level="unknown",
            score=0,
            evidence=(),
            config_fingerprint=fingerprint,
            signal_quality=quality,
            assessed_at_ms=assessed_at_ms,
        )

    vitals = {
        "heart_rate_bpm": float(heart_rate_bpm),
        "spo2_percent": float(spo2_percent),
        "temperature_c": float(temperature_c),
    }

    fired: list[RiskRuleResult] = []
    score = 0

    for rule in config.rules:
        value = vitals.get(rule.metric)
        if value is None:
            continue
        if rule.evaluate(value):
            score += rule.points
            comparison = "above" if rule.direction == "above" else "below"
            fired.append(
                RiskRuleResult(
                    rule=rule.name,
                    metric=rule.metric,
                    value=round(value, 2),
                    bound=rule.bound,
                    direction=comparison,
                    points=rule.points,
                    detail=f"{rule.metric} {value:.1f} is {comparison} {rule.bound:g}",
                )
            )

    # Trend rules: only for the metric the caller supplied a series for.
    if trend_values and trend_timestamps_ms:
        series = trend_from_readings(trend_values, trend_timestamps_ms)
        if series is not None:
            first, last, elapsed_seconds = series
            for rule in config.trend_rules:
                if rule.metric != trend_metric:
                    continue
                rate = rule.rate(first, last, elapsed_seconds)
                if rule.evaluate(rate):
                    score += rule.points
                    direction = "falling" if rule.per_minute < 0 else "rising"
                    fired.append(
                        RiskRuleResult(
                            rule=rule.name,
                            metric=rule.metric,
                            value=round(rate, 2),
                            bound=rule.per_minute,
                            direction=direction,
                            points=rule.points,
                            detail=f"{rule.metric} {direction} at {abs(rate):.1f}/min "
                                   f"(limit {abs(rule.per_minute):g}/min over {rule.window_seconds}s)",
                        )
                    )

    score = min(100, score)

    if score >= config.critical_score:
        level: RiskLevel = "critical"
    elif score >= config.attention_score:
        level = "attention"
    else:
        level = "normal"

    return RiskAssessment(
        level=level,
        score=score,
        evidence=tuple(fired),
        config_fingerprint=fingerprint,
        signal_quality=quality,
        assessed_at_ms=assessed_at_ms,
    )
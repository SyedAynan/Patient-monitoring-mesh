"""Transparent risk scoring — shared by edge nodes and the backend.

The same rule set, the same weights, the same thresholds run in two places:

- on each sensor node, so a patient's risk state is computed locally and keeps
  working when the gateway is unreachable (the local-first requirement);
- on the backend, which is authoritative for what the dashboard displays.

Because both import this module, they cannot drift apart. If they ever disagree,
that is a bug, not a tuning question.

Every assessment carries its evidence: which rules fired, the value that tripped
them, and the threshold that was crossed. A risk level is never a bare label —
it is always explainable from the recorded inputs (Phase 6 DoD).

The rules are deliberately simple and the thresholds are configurable. This is
prototype logic for evaluating a mesh network, **not a medical scoring system**:
nothing here diagnoses anything, and the default thresholds are round numbers
chosen for demonstrations, not clinical evidence.
"""

from .engine import (
    DEFAULT_CONFIG,
    RISK_LEVELS,
    RiskAssessment,
    RiskConfig,
    RiskLevel,
    RiskRuleResult,
    ThresholdRule,
    TrendRule,
    assess,
    trend_from_readings,
)

__all__ = [
    "DEFAULT_CONFIG",
    "RISK_LEVELS",
    "RiskAssessment",
    "RiskConfig",
    "RiskLevel",
    "RiskRuleResult",
    "ThresholdRule",
    "TrendRule",
    "assess",
    "trend_from_readings",
]

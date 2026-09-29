"""Sensing layer: synthetic sources, filtering, and quality estimation.

`VitalSource` is the seam a physical sensor driver will implement. `SignalFilter`
and the plausibility checks sit above it and are shared by every node, so real
and simulated sensors get identical processing.
"""

from .processing import (
    IMPLAUSIBLE_VALUES,
    MINIMUM_SIGNAL_QUALITY,
    NO_READINGS,
    UNSTABLE_SIGNAL,
    FilteredVitals,
    FilterOutcome,
    SignalFilter,
    is_plausible,
    validate_against_contract,
)
from .sources import (
    FaultySource,
    NoisySource,
    NominalSource,
    Reading,
    SensorUnavailable,
    TrendingSource,
    VitalSource,
)

__all__ = [
    "IMPLAUSIBLE_VALUES",
    "MINIMUM_SIGNAL_QUALITY",
    "NO_READINGS",
    "UNSTABLE_SIGNAL",
    "FaultySource",
    "FilterOutcome",
    "FilteredVitals",
    "NoisySource",
    "NominalSource",
    "Reading",
    "SensorUnavailable",
    "SignalFilter",
    "TrendingSource",
    "VitalSource",
    "is_plausible",
    "validate_against_contract",
]
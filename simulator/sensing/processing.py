"""Sample validation, filtering, and signal-quality estimation.

Everything here runs above the sensor and below the packet builder, and it is
shared by every node. Its job is to guarantee one thing: a packet that leaves a
node contains numbers inside the protocol's declared ranges, and its
`signal_quality` reflects how trustworthy those numbers actually are.

Bounded by construction: the filter keeps a fixed-length window, so a node's
memory does not grow with uptime (Rules section 9, M-10 in `docs/Evaluation.md`).
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Iterable

from shared.protocol import PacketValidationError, validate_packet

from .sources import Reading

# Physical plausibility bounds. Deliberately wider than the protocol's accepted
# range: a value inside these but outside the protocol range is still rejected by
# the packet validator, which remains the final authority.
PLAUSIBLE_HEART_RATE = (20.0, 250.0)
PLAUSIBLE_SPO2 = (50.0, 100.0)
PLAUSIBLE_TEMPERATURE = (25.0, 45.0)

# Rejection reasons, surfaced in `FilterOutcome.reason` and in diagnostics.
NO_READINGS = "NO_READINGS"
IMPLAUSIBLE_VALUES = "IMPLAUSIBLE_VALUES"
UNSTABLE_SIGNAL = "UNSTABLE_SIGNAL"
UNKNOWN = "UNKNOWN"

MINIMUM_SIGNAL_QUALITY = 0.25
_MAX_SIGNAL_QUALITY_NOISE = 8.0


@dataclass(frozen=True)
class FilteredVitals:
    """Filtered vitals plus the quality estimate that goes into the packet."""

    heart_rate_bpm: float
    spo2_percent: float
    temperature_c: float
    signal_quality: float
    samples_used: int


@dataclass(frozen=True)
class FilterOutcome:
    """Either filtered vitals or a reason this window could not produce any."""

    vitals: FilteredVitals | None
    reason: str | None

    @property
    def is_usable(self) -> bool:
        return self.vitals is not None


def _within(value: float, bounds: tuple[float, float]) -> bool:
    low, high = bounds
    return low <= value <= high


def is_plausible(reading: Reading) -> bool:
    """Reject physically impossible sensor output before it reaches a packet."""
    return (
        _within(reading.heart_rate_bpm, PLAUSIBLE_HEART_RATE)
        and _within(reading.spo2_percent, PLAUSIBLE_SPO2)
        and _within(reading.temperature_c, PLAUSIBLE_TEMPERATURE)
    )


class SignalFilter:
    """Fixed-window filter with a bounded history and a quality estimate.

    Quality is derived from the dispersion of the window rather than from an
    arbitrary constant, so a steadier signal reports higher quality. Mean
    absolute deviation is used instead of standard deviation because it does not
    amplify a single outlier reading.
    """

    def __init__(self, window_size: int = 5) -> None:
        if window_size < 1:
            raise ValueError("window_size must be at least 1")
        self.window_size = window_size
        self._heart_rate: list[float] = []
        self._spo2: list[float] = []
        self._temperature: list[float] = []
        self._rejected: int = 0

    def _push(self, series: list[float], value: float) -> None:
        series.append(value)
        if len(series) > self.window_size:
            del series[0]

    def observe(self, reading: Reading) -> None:
        """Add a reading to the window; implausible values are counted, not stored."""
        if not is_plausible(reading):
            self._rejected += 1
            return
        self._push(self._heart_rate, reading.heart_rate_bpm)
        self._push(self._spo2, reading.spo2_percent)
        self._push(self._temperature, reading.temperature_c)

    @property
    def rejected_readings(self) -> int:
        return self._rejected

    def _dispersion(self) -> float:
        """Mean absolute deviation of heart rate, the noisiest indicator."""
        if len(self._heart_rate) < 2:
            return 0.0
        mean = statistics.fmean(self._heart_rate)
        return statistics.fmean(abs(value - mean) for value in self._heart_rate)

    def signal_quality(self) -> float:
        """Quality in the protocol's 0.0-1.0 range, from window steadiness."""
        if not self._heart_rate:
            return 0.0
        dispersion = self._dispersion()
        quality = 1.0 - (dispersion / _MAX_SIGNAL_QUALITY_NOISE)
        return max(0.0, min(1.0, quality))

    def result(self) -> FilterOutcome:
        """Filter the current window, or explain why it cannot produce vitals."""
        if not self._heart_rate:
            return FilterOutcome(None, NO_READINGS)

        confidence = self.signal_quality()
        if confidence < MINIMUM_SIGNAL_QUALITY:
            return FilterOutcome(None, UNSTABLE_SIGNAL)

        vitals = FilteredVitals(
            heart_rate_bpm=round(statistics.fmean(self._heart_rate), 2),
            spo2_percent=round(statistics.fmean(self._spo2), 2),
            temperature_c=round(statistics.fmean(self._temperature), 2),
            signal_quality=round(confidence, 4),
            samples_used=len(self._heart_rate),
        )
        return FilterOutcome(vitals, None)


def clamp_to_protocol_range(vitals: FilteredVitals) -> FilteredVitals:
    """Clamp to the protocol's declared bounds as a final safety net.

    The filter should already keep values in range; this guarantees the packet
    builder cannot receive an out-of-range number, and clamping is reported by
    the caller rather than done silently.
    """
    from shared.protocol import _MEASUREMENT_LIMITS  # local: contract bounds live with the contract

    def clamp(value: float, field_name: str) -> float:
        low, high = _MEASUREMENT_LIMITS[field_name]
        return max(low, min(high, value))

    return FilteredVitals(
        heart_rate_bpm=clamp(vitals.heart_rate_bpm, "heart_rate_bpm"),
        spo2_percent=clamp(vitals.spo2_percent, "spo2_percent"),
        temperature_c=clamp(vitals.temperature_c, "temperature_c"),
        signal_quality=vitals.signal_quality,
        samples_used=vitals.samples_used,
    )


def validate_against_contract(packet: dict) -> dict:
    """Assert a built packet satisfies the protocol.

    Called by the node before transmission. If this raises, the node has a bug:
    it built a packet the authoritative validator rejects.
    """
    try:
        return validate_packet(packet)
    except PacketValidationError as exc:
        raise AssertionError(f"node built a packet the contract rejects: {exc}") from exc


def summarise_readings(readings: Iterable[Reading]) -> str:
    """Short human-readable summary used in diagnostics and test failures."""
    values = list(readings)
    if not values:
        return "no readings"
    return f"{len(values)} readings, last HR={values[-1].heart_rate_bpm:.1f}"
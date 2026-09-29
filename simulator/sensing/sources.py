"""Synthetic vital-sign sources standing in for physical sensors.

Each source produces one `Reading` per call, the way a sensor driver returns one
sample per conversion. A node collects several readings per packet and filters
them, which is what makes the packet rate lower than the sample rate.

Determinism: every source owns a seeded `random.Random`, so a seed reproduces a
scenario exactly. A physical driver will implement the same `VitalSource`
interface, so the node logic above it does not change.

No reading produced here is clinical data. These are synthetic numbers for
evaluation only (PRD section 12, NFR-07).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Reading:
    """One raw sensor conversion, before filtering or quality checks."""

    heart_rate_bpm: float
    spo2_percent: float
    temperature_c: float


class SensorUnavailable(Exception):
    """The sensor produced no value this time (disconnected, off, or timing out)."""


@runtime_checkable
class VitalSource(Protocol):
    """One sensor's conversion interface."""

    def read(self) -> Reading:
        """Return one reading, or raise `SensorUnavailable`."""
        ...


@dataclass
class NominalSource:
    """A patient in a stable state: small noise around a baseline."""

    heart_rate_bpm: float = 74.0
    spo2_percent: float = 98.0
    temperature_c: float = 36.7
    noise: float = 1.5
    seed: int = 1
    _rng: random.Random = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def read(self) -> Reading:
        return Reading(
            heart_rate_bpm=self.heart_rate_bpm + self._rng.gauss(0.0, self.noise),
            spo2_percent=self.spo2_percent + self._rng.gauss(0.0, self.noise * 0.3),
            temperature_c=self.temperature_c + self._rng.gauss(0.0, 0.05),
        )


@dataclass
class TrendingSource:
    """A patient deteriorating over time, for abnormal-scenario fixtures.

    The vitals move toward `target_*` over `duration_samples` readings. This
    produces the input a later risk-scoring phase will consume; it does not score
    anything itself.
    """

    heart_rate_bpm: float = 74.0
    spo2_percent: float = 98.0
    temperature_c: float = 36.7
    target_heart_rate_bpm: float = 150.0
    target_spo2_percent: float = 87.0
    target_temperature_c: float = 38.9
    duration_samples: int = 80
    noise: float = 1.5
    seed: int = 2
    _sample: int = 0
    _rng: random.Random = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.duration_samples < 1:
            raise ValueError("duration_samples must be at least 1")
        self._rng = random.Random(self.seed)

    def _progress(self) -> float:
        return min(1.0, self._sample / self.duration_samples)

    def read(self) -> Reading:
        fraction = self._progress()
        self._sample += 1
        blend = lambda start, end: start + (end - start) * fraction  # noqa: E731
        return Reading(
            heart_rate_bpm=blend(self.heart_rate_bpm, self.target_heart_rate_bpm)
            + self._rng.gauss(0.0, self.noise),
            spo2_percent=blend(self.spo2_percent, self.target_spo2_percent)
            + self._rng.gauss(0.0, self.noise * 0.3),
            temperature_c=blend(self.temperature_c, self.target_temperature_c)
            + self._rng.gauss(0.0, 0.05),
        )


@dataclass
class NoisySource:
    """A patient whose sensor contact is poor: usable but degraded signal.

    Readings stay inside the protocol's valid ranges; the dispersion is what the
    node's quality estimate reports.
    """

    heart_rate_bpm: float = 78.0
    spo2_percent: float = 96.0
    temperature_c: float = 36.6
    # Dispersion tuned so a poor-contact patient yields a low-but-usable quality
    # score. The node's minimum-quality gate is what rejects a signal beyond hope.
    noise: float = 6.0
    seed: int = 3
    _rng: random.Random = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def read(self) -> Reading:
        return Reading(
            heart_rate_bpm=self.heart_rate_bpm + self._rng.gauss(0.0, self.noise),
            spo2_percent=max(0.0, min(100.0, self.spo2_percent + self._rng.gauss(0.0, 4.0))),
            temperature_c=self.temperature_c + self._rng.gauss(0.0, 0.2),
        )


@dataclass
class FaultySource:
    """A sensor that intermittently fails or returns physically impossible values.

    It wraps another source. `unavailable_every` and `implausible_every` decide
    how often it raises or returns junk. The node must never turn either into a
    valid-looking packet.
    """

    inner: VitalSource
    unavailable_every: int = 7
    implausible_every: int = 11
    seed: int = 4
    _sample: int = 0
    _rng: random.Random = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def read(self) -> Reading:
        self._sample += 1
        if self.unavailable_every > 0 and self._sample % self.unavailable_every == 0:
            raise SensorUnavailable(f"sensor {self._sample} produced no value")
        if self.implausible_every > 0 and self._sample % self.implausible_every == 0:
            # Beyond the protocol's valid range: the node must reject this.
            return Reading(
                heart_rate_bpm=999.0,
                spo2_percent=-5.0,
                temperature_c=250.0,
            )
        return self.inner.read()
"""Sensor node role: sample, filter, build a contract-valid packet, transmit.

The node owns no radio knowledge beyond "hand this frame to my next hop". Every
packet it builds goes through the authoritative builder and validator in
`shared/protocol`, so the wire format is the same one the fixtures pin down.

This is the Phase 2 boundary. Deliberately *not* implemented here, because a
later phase owns each one:

- Store-and-forward buffering and backfill (Phase 4). A packet that cannot be
  handed to the link is counted as dropped, not retained.
- Priority policy (Phase 3). `priority` is configurable and defaults to routine;
  deciding *when* a patient becomes critical is Phase 6.
- Risk scoring (Phase 6). The `risk` block is left unset.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from shared.protocol import PacketValidationError, make_packet

from ..sensing.processing import FilterOutcome, SignalFilter, validate_against_contract
from ..sensing.sources import SensorUnavailable, VitalSource, is_plausible
from ..transport import Frame, LinkUnavailable, Transport


@dataclass
class NodeConfig:
    """Identity, addressing, and sampling settings for one sensor node."""

    device_id: str
    patient_id: str
    gateway_id: str
    next_hop: str
    samples_per_packet: int = 5
    window_size: int = 5
    priority: str = "routine"

    def __post_init__(self) -> None:
        if self.samples_per_packet < 1:
            raise ValueError("samples_per_packet must be at least 1")


@dataclass
class NodeStats:
    """Everything the node did, so tests and experiments can account for it."""

    samples_read: int = 0
    sensor_unavailable: int = 0
    implausible_readings: int = 0
    windows_skipped: int = 0
    packets_built: int = 0
    packets_sent: int = 0
    packets_dropped_link_unavailable: int = 0
    packets_failed_contract: int = 0
    last_skip_reason: str | None = None


@dataclass
class SensorNode:
    """One simulated patient sensor node."""

    config: NodeConfig
    source: VitalSource
    transport: Transport
    stats: NodeStats = field(default_factory=NodeStats)
    _filter: SignalFilter = field(init=False, repr=False)
    _sequence: int = field(default=1, init=False)
    _samples_since_packet: int = field(default=0, init=False)
    _last_captured_at_ms: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        self._filter = SignalFilter(window_size=self.config.window_size)

    @property
    def device_id(self) -> str:
        return self.config.device_id

    @property
    def patient_id(self) -> str:
        return self.config.patient_id

    @property
    def next_sequence_number(self) -> int:
        return self._sequence

    @property
    def signal_quality(self) -> float:
        return self._filter.signal_quality()

    def sample(self, captured_at_ms: int) -> None:
        """Read the sensor once and add the reading to the filter window."""
        try:
            reading = self.source.read()
        except SensorUnavailable:
            self.stats.sensor_unavailable += 1
            return
        self.stats.samples_read += 1
        if not is_plausible(reading):
            # Never let a physically impossible value reach the packet builder.
            self.stats.implausible_readings += 1
            return
        self._filter.observe(reading)
        self._samples_since_packet += 1
        self._last_captured_at_ms = captured_at_ms

    def _build_packet(self) -> dict:
        outcome: FilterOutcome = self._filter.result()
        if not outcome.is_usable:
            self.stats.windows_skipped += 1
            self.stats.last_skip_reason = outcome.reason
            return {}
        vitals = outcome.vitals
        assert vitals is not None
        packet = make_packet(
            device_id=self.config.device_id,
            patient_id=self.config.patient_id,
            sequence_number=self._sequence,
            captured_at_ms=self._last_captured_at_ms,
            heart_rate_bpm=vitals.heart_rate_bpm,
            spo2_percent=vitals.spo2_percent,
            temperature_c=vitals.temperature_c,
            priority=self.config.priority,
            signal_quality=vitals.signal_quality,
        )
        # The node is the first boundary; the gateway validates again on receipt.
        return validate_against_contract(packet)

    def tick(self, captured_at_ms: int) -> bool:
        """One sampling instant. Returns True when a packet was built and sent.

        A packet is only attempted once enough samples have accumulated. A retry
        after a link failure reuses the same sequence number, per the protocol's
        reliability rules; only a successfully sent packet advances it.
        """
        self.sample(captured_at_ms)
        if self._samples_since_packet < self.config.samples_per_packet:
            return False

        self._samples_since_packet = 0
        packet = self._build_packet()
        if not packet:
            return False

        self.stats.packets_built += 1
        frame = Frame(
            source=self.config.device_id,
            destination=self.config.gateway_id,
            message_id=f"{self.config.device_id}:{packet['sequence_number']}",
            payload=self._encode(packet),
        )
        try:
            self.transport.transmit(self.config.next_hop, frame.to_bytes())
        except LinkUnavailable:
            # Phase 4 owns buffering; for now the packet is counted as lost and
            # the sequence number is NOT advanced, so a later attempt reuses it.
            self.stats.packets_dropped_link_unavailable += 1
            return False

        self.stats.packets_sent += 1
        self._sequence += 1
        return True

    def _encode(self, packet: dict) -> bytes:
        from shared.protocol import encode_packet

        try:
            return encode_packet(packet)
        except PacketValidationError:
            # Unreachable while `_build_packet` validates first; counted so a
            # future edit that breaks that guarantee is visible rather than silent.
            self.stats.packets_failed_contract += 1
            raise
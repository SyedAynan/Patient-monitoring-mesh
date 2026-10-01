"""Sensor node role: sample, filter, build a contract-valid packet, transmit.

The node owns no radio knowledge beyond "hand this frame to my next hop". Every
packet it builds goes through the authoritative builder and validator in
`shared/protocol`, so the wire format is the same one the fixtures pin down.

Phase 3 adds the transmit side of prioritized delivery: built packets go into a
bounded critical-first queue, are sent with bounded retries, and are removed only
once acknowledged. A message that exhausts its retry budget becomes *failed*, and
a later sample supersedes it with a new sequence number — the node never retries
forever, and it never lets a stale packet hold the queue.

Deliberately *not* here, because a later phase owns each one:

- Store-and-forward buffering across a long outage (Phase 4). The queue is
  bounded on purpose, and a frame refused at the bound is counted, not retained.
- Deciding *when* a patient becomes critical (Phase 6). `priority` is configurable;
  the node does not yet score risk.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from shared.protocol import PacketValidationError, decode_packet, make_packet

from ..sensing.processing import (
    FilterOutcome,
    SignalFilter,
    is_plausible,
    validate_against_contract,
)
from ..sensing.sources import SensorUnavailable, VitalSource
from ..transport import Frame, FrameError, LinkUnavailable, Transport
from .priority import (
    PRIORITY_ROUTINE,
    PRIORITY_ORDER,
    PendingFrame,
    PriorityQueue,
    RetryPolicy,
)


@dataclass
class NodeConfig:
    """Identity, addressing, and sampling settings for one sensor node."""

    device_id: str
    patient_id: str
    gateway_id: str
    next_hop: str
    samples_per_packet: int = 5
    window_size: int = 5
    priority: str = PRIORITY_ROUTINE
    queue_capacity: int = 64
    max_attempts: int = 3
    # Phase 4: alternate next hop used when the primary becomes unreachable.
    # None keeps the Phase 3 single-path behaviour.
    alternate_hop: str | None = None
    # Consecutive transmit failures on the current hop before switching.
    reroute_after_failures: int = 2

    def __post_init__(self) -> None:
        if self.samples_per_packet < 1:
            raise ValueError("samples_per_packet must be at least 1")
        if self.priority not in PRIORITY_ORDER:
            raise ValueError(f"priority must be one of {PRIORITY_ORDER}")
        if self.reroute_after_failures < 1:
            raise ValueError("reroute_after_failures must be at least 1")


@dataclass
class NodeStats:
    """Everything the node did, so tests and experiments can account for it."""

    samples_read: int = 0
    sensor_unavailable: int = 0
    implausible_readings: int = 0
    windows_skipped: int = 0
    packets_built: int = 0
    packets_sent: int = 0
    packets_acknowledged: int = 0
    retransmissions: int = 0
    packets_failed_retry_exhausted: int = 0
    packets_refused_queue_full: int = 0
    packets_evicted_for_priority: int = 0
    packets_dropped_link_unavailable: int = 0
    packets_failed_contract: int = 0
    acks_received: int = 0
    acks_ignored: int = 0
    last_skip_reason: str | None = None
    # Phase 4: route changes and when the latest one happened.
    route_changes: int = 0
    last_route_change_at_ms: int | None = None


@dataclass
class SensorNode:
    """One simulated patient sensor node."""

    config: NodeConfig
    source: VitalSource
    transport: Transport
    stats: NodeStats = field(default_factory=NodeStats)
    queue: PriorityQueue = field(init=False)
    retry_policy: RetryPolicy = field(init=False)
    _filter: SignalFilter = field(init=False, repr=False)
    _sequence: int = field(default=1, init=False)
    _samples_since_packet: int = field(default=0, init=False)
    _last_captured_at_ms: int = field(default=0, init=False)
    _consecutive_failures: int = field(default=0, init=False)
    _active_hop: str | None = field(default=None, init=False)

    def __post_init__(self) -> None:
        self._filter = SignalFilter(window_size=self.config.window_size)
        self.queue = PriorityQueue(capacity=self.config.queue_capacity)
        self.retry_policy = RetryPolicy(max_attempts=self.config.max_attempts)
        self._active_hop = self.config.next_hop

    @property
    def active_hop(self) -> str:
        """The hop currently in use, after any route change."""
        return self._active_hop or self.config.next_hop

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

    @property
    def queue_depth(self) -> int:
        return self.queue.depth

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

    def _build_packet(self) -> dict | None:
        outcome: FilterOutcome = self._filter.result()
        if not outcome.is_usable:
            self.stats.windows_skipped += 1
            self.stats.last_skip_reason = outcome.reason
            return None
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
        return validate_against_contract(packet)

    def _enqueue(self, packet: dict) -> bool:
        try:
            payload = _encode(packet)
        except PacketValidationError:
            self.stats.packets_failed_contract += 1
            raise
        frame = Frame(
            source=self.config.device_id,
            destination=self.config.gateway_id,
            message_id=f"{self.config.device_id}:{packet['sequence_number']}",
            payload=payload,
        )
        admitted = self.queue.enqueue(frame, priority=self.config.priority)
        if admitted:
            for pending in self.queue.pending_messages():
                if pending.message_id == frame.message_id:
                    pending.sequence_number = packet["sequence_number"]
                    break
        return admitted

    def _reroute(self, captured_at_ms: int | None = None) -> bool:
        """Switch to the alternate hop when the active one is failing.

        Returns True when a route change happened. A route change is a recorded
        network event, not a silent reconfiguration: `stats.route_changes` counts
        it and `last_route_change_at_ms` stamps when.
        """
        if self.config.alternate_hop is None:
            return False
        if self._active_hop == self.config.alternate_hop:
            return False
        self._active_hop = self.config.alternate_hop
        self.stats.route_changes += 1
        if captured_at_ms is not None:
            self.stats.last_route_change_at_ms = captured_at_ms
        return True

    def _maybe_reroute(self, captured_at_ms: int | None) -> None:
        """Reroute after `reroute_after_failures` consecutive transmit failures.

        Failure means the radio could not hand the frame to the current hop
        (`LinkUnavailable`), which on real hardware is the observable symptom of
        a dead relay: no acknowledgement and no delivery.
        """
        if self._consecutive_failures >= self.config.reroute_after_failures:
            if self._reroute(captured_at_ms):
                self._consecutive_failures = 0

    def _transmit_pending(self, captured_at_ms: int | None = None) -> None:
        """Send the highest-priority pending frame, retrying within budget.

        Called once per tick, so at most one message is attempted per tick. That
        keeps a busy queue from monopolising the radio and makes retry timing
        observable in tests.
        """
        pending: PendingFrame | None = self.queue.next_to_send()
        if pending is None:
            return
        if not self.retry_policy.has_budget(pending.attempts):
            self.stats.packets_failed_retry_exhausted += 1
            self.queue.discard(pending)
            return

        try:
            self.transport.transmit(self.active_hop, pending.frame.to_bytes())
        except LinkUnavailable:
            # The radio refused the frame; it was never put on the wire, so this
            # is not an attempt and no budget is consumed. The message stays
            # queued for the next tick.
            self.stats.packets_dropped_link_unavailable += 1
            self._consecutive_failures += 1
            self._maybe_reroute(captured_at_ms)
            return
        except FrameError:
            self.stats.packets_failed_contract += 1
            self.queue.discard(pending)
            return
        pending.attempts += 1
        if pending.attempts > 1:
            self.stats.retransmissions += 1
        self.stats.packets_sent += 1
        # A successful handoff to the current hop means the route works; the
        # consecutive-failure counter tracks the hop's health, not the link's
        # per-frame luck.
        self._consecutive_failures = 0

    def _handle_acks(self) -> None:
        """Consume acknowledgement frames addressed to this node."""
        for raw in self.transport.poll():
            try:
                frame = Frame.from_bytes(raw)
            except FrameError:
                continue
            if frame.destination != self.config.device_id or frame.kind != "ack":
                continue
            self.stats.acks_received += 1
            if self.queue.acknowledge(frame.acks or ""):
                self.stats.packets_acknowledged += 1
            else:
                # A duplicate ack is expected under retries, not an error.
                self.stats.acks_ignored += 1

    def tick(self, captured_at_ms: int) -> bool:
        """One sampling instant. Returns True when a new packet was queued."""
        self._handle_acks()
        self.sample(captured_at_ms)

        queued = False
        if self._samples_since_packet >= self.config.samples_per_packet:
            self._samples_since_packet = 0
            packet = self._build_packet()
            if packet is not None:
                self.stats.packets_built += 1
                if self._enqueue(packet):
                    # Only a queued message consumes a sequence number, so a
                    # retry keeps reusing the same one.
                    self._sequence += 1
                    queued = True
                else:
                    self.stats.packets_refused_queue_full += 1

        self._transmit_pending(captured_at_ms)
        self.stats.packets_evicted_for_priority = self.queue.evicted_for_priority
        return queued

    def pending_messages(self) -> list[PendingFrame]:
        return self.queue.pending_messages()


def _encode(packet: dict) -> bytes:
    from shared.protocol import encode_packet

    return encode_packet(packet)


def decode_payload(payload: bytes) -> dict:
    """Decode a frame payload as a telemetry packet; used by receivers."""
    return decode_packet(payload)
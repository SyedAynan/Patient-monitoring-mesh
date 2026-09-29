"""Deterministic simulated link with controllable faults.

`SimulatedMedium` owns the routing table, the per-endpoint inboxes, and every
injected fault. Each `SimulatedTransport` is one endpoint's view of it, matching
the shape a real per-device radio will have.

Determinism: one seeded `random.Random` drives every fault decision, and each
transmission consumes exactly `_DRAWS_PER_TRANSMIT` values whether or not the
faults fire. So changing a fault rate changes the outcome without desynchronising
the stream, and a given seed reproduces a run exactly.

Faults available (all off by default):

- `loss_rate` — the frame never arrives.
- `corruption_rate` — bytes arrive damaged and must be rejected safely.
- `duplication_rate` — the frame arrives twice; the receiver must deduplicate.
- `reorder_rate` — the frame is held and released after the next one, so it
  arrives out of order.
- unavailable links — transmitting raises `LinkUnavailable`, modelling a radio
  that is off or a neighbour out of range.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .base import MAX_ENDPOINT_ID_LENGTH, EndpointId, LinkUnavailable
from .envelope import Frame, FrameError

_DRAWS_PER_TRANSMIT = 4


@dataclass
class MediumStats:
    """Every frame outcome, so experiments can account for all traffic."""

    transmitted: int = 0
    delivered: int = 0
    dropped: int = 0
    corrupted: int = 0
    duplicated: int = 0
    deferred: int = 0
    refused_unavailable: int = 0
    rejected_unroutable: int = 0


@dataclass
class SimulatedMedium:
    """A shared radio medium connecting named endpoints."""

    seed: int = 20260928
    loss_rate: float = 0.0
    corruption_rate: float = 0.0
    duplication_rate: float = 0.0
    reorder_rate: float = 0.0
    stats: MediumStats = field(default_factory=MediumStats)
    _rng: random.Random = field(init=False, repr=False)
    _links: dict[tuple[EndpointId, EndpointId], bool] = field(default_factory=dict, repr=False)
    _inboxes: dict[EndpointId, list[bytes]] = field(default_factory=dict, repr=False)
    _deferred: dict[EndpointId, list[bytes]] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)
        for rate, name in (
            (self.loss_rate, "loss_rate"),
            (self.corruption_rate, "corruption_rate"),
            (self.duplication_rate, "duplication_rate"),
            (self.reorder_rate, "reorder_rate"),
        ):
            if not 0.0 <= rate <= 1.0:
                raise ValueError(f"{name} must be between 0.0 and 1.0")

    # -- topology ---------------------------------------------------------

    def register(self, endpoint_id: EndpointId) -> None:
        if not isinstance(endpoint_id, str) or not endpoint_id:
            raise ValueError("endpoint_id must be a non-empty string")
        if len(endpoint_id) > MAX_ENDPOINT_ID_LENGTH:
            raise ValueError(f"endpoint_id must be at most {MAX_ENDPOINT_ID_LENGTH} characters")
        self._inboxes.setdefault(endpoint_id, [])
        self._deferred.setdefault(endpoint_id, [])

    def connect(self, a: EndpointId, b: EndpointId, available: bool = True) -> None:
        """Make `a` and `b` adjacent, in both directions."""
        self.register(a)
        self.register(b)
        self._links[(a, b)] = available
        self._links[(b, a)] = available

    def set_link(self, a: EndpointId, b: EndpointId, available: bool) -> None:
        """Bring an existing link up or down, modelling a radio being switched."""
        if (a, b) not in self._links:
            raise KeyError(f"{a} and {b} are not adjacent")
        self._links[(a, b)] = available
        self._links[(b, a)] = available

    def is_adjacent(self, a: EndpointId, b: EndpointId) -> bool:
        return (a, b) in self._links

    def is_link_available(self, a: EndpointId, b: EndpointId) -> bool:
        return self._links.get((a, b), False)

    def neighbours(self, endpoint_id: EndpointId) -> list[EndpointId]:
        return sorted(other for (a, other) in self._links if a == endpoint_id)

    def transport(self, endpoint_id: EndpointId) -> "SimulatedTransport":
        self.register(endpoint_id)
        return SimulatedTransport(self, endpoint_id)

    # -- transmission -----------------------------------------------------

    def _deliver(self, endpoint_id: EndpointId, raw: bytes) -> None:
        self._flush_deferred(endpoint_id)
        self._inboxes[endpoint_id].append(raw)
        self.stats.delivered += 1

    def _flush_deferred(self, endpoint_id: EndpointId) -> None:
        """Release a held frame after the next one lands, forcing out-of-order."""
        held = self._deferred[endpoint_id]
        if held:
            self._inboxes[endpoint_id].extend(held)
            self.stats.delivered += len(held)
            held.clear()

    def _corrupt(self, raw: bytes) -> bytes:
        """Damage a frame so a receiver must reject it rather than trust it."""
        if len(raw) < 6:
            return b"\x00\x00"
        return raw[:4] + b"\xff" + raw[5:]

    def send(self, sender: EndpointId, neighbour: EndpointId, frame: Frame) -> None:
        self.stats.transmitted += 1

        if not self.is_link_available(sender, neighbour):
            self.stats.refused_unavailable += 1
            raise LinkUnavailable(f"no link from {sender} to {neighbour}")

        try:
            raw = frame.to_bytes()
        except FrameError:
            self.stats.rejected_unroutable += 1
            raise

        # Fixed draw count keeps the stream aligned across configuration changes.
        drop_roll = self._rng.random()
        corrupt_roll = self._rng.random()
        duplicate_roll = self._rng.random()
        reorder_roll = self._rng.random()

        if drop_roll < self.loss_rate:
            self.stats.dropped += 1
            return

        if corrupt_roll < self.corruption_rate:
            self.stats.corrupted += 1
            self._deliver(neighbour, self._corrupt(raw))
            return

        if reorder_roll < self.reorder_rate:
            self.stats.deferred += 1
            self._deferred[neighbour].append(raw)
            return

        self._deliver(neighbour, raw)
        if duplicate_roll < self.duplication_rate:
            self.stats.duplicated += 1
            self._deliver(neighbour, raw)

    def inbox_depth(self, endpoint_id: EndpointId) -> int:
        return len(self._inboxes.get(endpoint_id, ()))

    def drain(self, endpoint_id: EndpointId) -> list[bytes]:
        self._flush_deferred(endpoint_id)
        inbox = self._inboxes[endpoint_id]
        frames = list(inbox)
        inbox.clear()
        return frames

    def reset_counters(self) -> None:
        self.stats = MediumStats()


@dataclass(frozen=True)
class SimulatedTransport:
    """One endpoint's radio, backed by a `SimulatedMedium`."""

    medium: SimulatedMedium
    endpoint_id: EndpointId

    def transmit(self, neighbour: EndpointId, frame: bytes) -> None:
        try:
            parsed = Frame.from_bytes(frame)
        except FrameError:
            raise
        self.medium.send(self.endpoint_id, neighbour, parsed)

    def poll(self) -> list[bytes]:
        return self.medium.drain(self.endpoint_id)

    def neighbours(self) -> list[EndpointId]:
        return self.medium.neighbours(self.endpoint_id)

    def is_link_available(self, neighbour: EndpointId) -> bool:
        return self.medium.is_link_available(self.endpoint_id, neighbour)
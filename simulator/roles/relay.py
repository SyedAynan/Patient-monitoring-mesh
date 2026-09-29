"""Relay role: forward frames onward without reading what they carry.

The relay is the networking surface of this project. It parses only the routing
envelope, never the telemetry payload, and forwards toward the next hop.

Honest scope: this is application-level relaying with a configured next hop, not
a routing protocol. There is no path discovery, no metric-based route choice, and
no route-change detection — those are Phase 4, and the project must not claim
"self-healing mesh" behavior before Phase 4 measures it (Rules section 9). What
this does prove is that a frame survives a second hop with its identity intact,
which is the assumption the whole transport design rests on (risk R-01).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..transport import Frame, FrameError, LinkUnavailable, Transport


@dataclass
class RelayStats:
    """Traffic accounting for one relay."""

    received: int = 0
    forwarded: int = 0
    dropped_unroutable: int = 0
    dropped_unknown_destination: int = 0
    dropped_link_unavailable: int = 0
    dropped_hop_limit: int = 0


@dataclass
class RelayNode:
    """Forwards frames toward a configured next hop."""

    relay_id: str
    next_hop: str
    transport: Transport
    # Endpoints this relay will accept frames from. Empty means "accept any",
    # which is what the simulator uses; a lab deployment would restrict it.
    allowed_sources: frozenset[str] = field(default_factory=frozenset)
    stats: RelayStats = field(default_factory=RelayStats)

    def _should_forward(self, frame: Frame) -> bool:
        if not self.allowed_sources:
            return True
        return frame.source in self.allowed_sources

    def tick(self) -> int:
        """Drain the inbox and forward everything routable. Returns frames forwarded."""
        forwarded_this_tick = 0
        for raw in self.transport.poll():
            self.stats.received += 1
            try:
                frame = Frame.from_bytes(raw)
            except FrameError:
                # A corrupted or malformed frame must not stop the relay.
                self.stats.dropped_unroutable += 1
                continue

            if not self._should_forward(frame):
                self.stats.dropped_unknown_destination += 1
                continue

            # A frame already at its destination is not the relay's business.
            if frame.destination == self.relay_id:
                self.stats.dropped_unknown_destination += 1
                continue

            try:
                onward = frame.forwarded_by(self.relay_id)
            except FrameError:
                self.stats.dropped_hop_limit += 1
                continue

            try:
                self.transport.transmit(self.next_hop, onward.to_bytes())
            except LinkUnavailable:
                # No Phase 4 buffering yet: counted, not retained.
                self.stats.dropped_link_unavailable += 1
                continue

            self.stats.forwarded += 1
            forwarded_this_tick += 1
        return forwarded_this_tick
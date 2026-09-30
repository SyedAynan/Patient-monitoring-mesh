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
    """Forwards frames between leaf endpoints and the gateway.

    A frame is sent toward the gateway when its destination is not a leaf this
    relay serves, and back to the leaf when it is — which is what carries an
    acknowledgement home to the node that is waiting for it. The relay still
    reads only the routing header: `kind` and `acks` belong to the envelope, and
    the payload stays opaque.
    """

    relay_id: str
    next_hop: str
    transport: Transport
    # Endpoints this relay will accept frames from. Empty means "accept any",
    # which is what the simulator uses; a lab deployment would restrict it.
    allowed_sources: frozenset[str] = field(default_factory=frozenset)
    # Leaf endpoints reachable through this relay. A frame addressed to one of
    # these goes back down; anything else is sent onward to `next_hop`.
    downstream: frozenset[str] = field(default_factory=frozenset)
    stats: RelayStats = field(default_factory=RelayStats)

    def _should_forward(self, frame: Frame) -> bool:
        if not self.allowed_sources:
            return True
        return frame.source in self.allowed_sources

    def _route_for(self, frame: Frame) -> str | None:
        """Which neighbour to hand this frame to, or None if unroutable."""
        # A frame already at its destination is not the relay's business.
        if frame.destination == self.relay_id:
            return None
        if frame.destination in self.downstream:
            return frame.destination
        if frame.source in self.downstream:
            return self.next_hop
        # Unknown destination and unknown source: only forwardable when the relay
        # is not partitioning the network, i.e. when it has no declared leaves.
        if not self.downstream:
            return self.next_hop
        return None

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

            neighbour = self._route_for(frame)
            if neighbour is None:
                self.stats.dropped_unknown_destination += 1
                continue

            try:
                onward = frame.forwarded_by(self.relay_id)
            except FrameError:
                self.stats.dropped_hop_limit += 1
                continue

            try:
                self.transport.transmit(neighbour, onward.to_bytes())
            except LinkUnavailable:
                # No Phase 4 buffering yet: counted, not retained.
                self.stats.dropped_link_unavailable += 1
                continue

            self.stats.forwarded += 1
            forwarded_this_tick += 1
        return forwarded_this_tick
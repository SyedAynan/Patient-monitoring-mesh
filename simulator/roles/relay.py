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

from collections import deque
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
    # Phase 4: store-and-forward accounting. A frame buffered while the uplink
    # is down is `buffered`; one that left the buffer after recovery is
    # `backfilled`. `buffer_dropped` counts buffer-bound losses.
    buffered: int = 0
    backfilled: int = 0
    buffer_dropped: int = 0
    # Phase 4: a route change away from this relay is invisible to it, so the
    # mesh-level recorder owns that event instead.


@dataclass
class RelayNode:
    """Forwards frames between leaf endpoints and the gateway.

    A frame is sent toward the gateway when its destination is not a leaf this
    relay serves, and back to the leaf when it is — which is what carries an
    acknowledgement home to the node that is waiting for it. The relay still
    reads only the routing header: `kind` and `acks` belong to the envelope, and
    the payload stays opaque.

    Phase 4 adds store-and-forward on the uplink: when the gateway link is
    unavailable, upstream frames are retained in a bounded buffer and backfilled
    in FIFO order when the link returns. Buffered frames are re-sent as-is, so
    the gateway's `(device_id, sequence_number)` dedup keeps a backfill from
    ever creating duplicate records.
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
    # Phase 4: bound for the store-and-forward buffer. Zero disables buffering
    # (the Phase 3 behaviour: count and drop).
    buffer_capacity: int = 0

    stats: RelayStats = field(default_factory=RelayStats)
    _buffer: deque[Frame] = field(default_factory=deque, repr=False)

    def __post_init__(self) -> None:
        if self.buffer_capacity < 0:
            raise ValueError("buffer_capacity must not be negative")

    @property
    def buffer_depth(self) -> int:
        return len(self._buffer)

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

    def _is_upstream(self, frame: Frame) -> bool:
        return frame.destination != self.relay_id and frame.destination not in self.downstream

    def _buffer_frame(self, frame: Frame) -> None:
        """Retain a frame for backfill, evicting the oldest if the bound is hit.

        A frame already in the buffer is never re-buffered, so an upstream
        retransmission cannot fill the buffer with its own duplicates.
        """
        if any(buffered.message_id == frame.message_id for buffered in self._buffer):
            self.stats.dropped_unknown_destination += 1
            return
        while len(self._buffer) >= self.buffer_capacity:
            self._buffer.popleft()
            self.stats.buffer_dropped += 1
        self._buffer.append(frame)
        self.stats.buffered += 1

    def _try_transmit(self, frame: Frame, neighbour: str) -> bool:
        """Forward one frame; returns True when it was handed to the link."""
        try:
            onward = frame.forwarded_by(self.relay_id)
        except FrameError:
            self.stats.dropped_hop_limit += 1
            return True  # consumed: hop-limited frames are not retried
        try:
            self.transport.transmit(neighbour, onward.to_bytes())
        except LinkUnavailable:
            return False
        self.stats.forwarded += 1
        return True

    def _drain_buffer(self) -> int:
        """Backfill buffered frames now that the uplink is back. FIFO, bounded."""
        backfilled = 0
        while self._buffer:
            frame = self._buffer[0]
            if self._try_transmit(frame, self.next_hop):
                self._buffer.popleft()
                self.stats.backfilled += 1
                backfilled += 1
            else:
                break
        return backfilled

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

            if self._try_transmit(frame, neighbour):
                forwarded_this_tick += 1
            elif self._is_upstream(frame) and self.buffer_capacity:
                # Uplink is down and this frame is headed up: keep it for backfill
                # rather than dropping it on the floor.
                self._buffer_frame(frame)
            else:
                self.stats.dropped_link_unavailable += 1

        # An uplink that works again releases everything that was held.
        self._drain_buffer()
        return forwarded_this_tick
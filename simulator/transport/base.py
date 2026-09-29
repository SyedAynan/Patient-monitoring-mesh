"""Transport abstraction: opaque frame bytes between endpoints.

The application layer (sensor node, relay, gateway) only ever talks to this
interface. That is what lets a future `EspNowTransport` replace
`SimulatedTransport` without changing packet building, validation, relay logic,
or the gateway — the protocol and application layers never see the radio.

The abstraction is deliberately per-endpoint, because a real radio is
per-device: each board owns one radio. In the simulator those per-endpoint
objects share a `SimulatedMedium` that routes frames and injects faults.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

EndpointId = str

# Longest endpoint identifier accepted on the wire. Bounded so a malformed frame
# cannot carry an unbounded identifier (Rules section 9: bound all buffers).
MAX_ENDPOINT_ID_LENGTH = 32


class LinkUnavailable(Exception):
    """Raised when a frame cannot be handed to the link at all.

    This is a transport-level failure, not a dropped frame: nothing was put on
    the wire, so the caller still owns the frame and is expected to buffer it.
    A future lossy radio keeps the same distinction: "the radio is off" versus
    "the radio transmitted and we do not know what arrived".
    """


@runtime_checkable
class Transport(Protocol):
    """One endpoint's view of the network — its radio and its inbox."""

    @property
    def endpoint_id(self) -> EndpointId:
        """Identifier this endpoint is addressable by."""
        ...

    def transmit(self, neighbour: EndpointId, frame: bytes) -> None:
        """Hand one frame to the link for delivery to an adjacent endpoint.

        `neighbour` is the next hop, not necessarily the final destination; the
        frame envelope carries the final destination. Raises `LinkUnavailable`
        if the link to that neighbour cannot be used right now.
        """
        ...

    def poll(self) -> list[bytes]:
        """Return every frame that has arrived here and clear the inbox."""
        ...
"""Placeholder for the physical ESP-NOW transport.

This module exists to fix the seam, not to work. It is the concrete proof that
Phase 2's abstraction is the right shape: an ESP-NOW implementation slots in here
and every role above — node, relay, gateway — keeps working unchanged, because
they depend on `Transport` and on `Frame`, never on `SimulatedMedium`.

**Status: NOT IMPLEMENTED. Physical ESP32/ESP-NOW validation is DEFERRED until
hardware is available.** Do not report anything here as working, and do not
describe the project as ESP-NOW validated while this raises.

What a real implementation has to do, and what the simulator already models so
the swap is mechanical:

- `transmit(neighbour, frame)` maps to `esp_now_send` to that peer's MAC.
- `poll()` drains a receive callback queue, which is asynchronous on real
  hardware. The simulator's synchronous inbox stands in for that queue.
- ESP-NOW is connectionless peer-to-peer with no built-in routing, so a relay
  hop stays an application-layer concern — the same `Frame.forwarded_by` step
  the relay already performs (risk R-01).
- ESP-NOW's payload limit (250 bytes) is *smaller* than this project's maximum
  frame size. That gap must be resolved before firmware work starts: either the
  envelope shrinks, or payloads are fragmented at the application layer. The
  simulator deliberately does not hide this, which is why `MAX_PAYLOAD_LENGTH`
  is configuration rather than an assumption.
"""

from __future__ import annotations

from .base import EndpointId, LinkUnavailable

NOT_IMPLEMENTED_MESSAGE = (
    "EspNowTransport is not implemented. Physical ESP32/ESP-NOW validation is "
    "DEFERRED until hardware is available. Use SimulatedMedium for all current work."
)


class EspNowTransport:
    """Unimplemented ESP-NOW transport. Raises on every operation."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        raise NotImplementedError(NOT_IMPLEMENTED_MESSAGE)

    @property
    def endpoint_id(self) -> EndpointId:
        raise NotImplementedError(NOT_IMPLEMENTED_MESSAGE)

    def transmit(self, neighbour: EndpointId, frame: bytes) -> None:
        raise NotImplementedError(NOT_IMPLEMENTED_MESSAGE)

    def poll(self) -> list[bytes]:
        raise NotImplementedError(NOT_IMPLEMENTED_MESSAGE)


class EspNowLinkUnavailable(LinkUnavailable):
    """Reserved for real radio failures once ESP-NOW is implemented."""


def is_available() -> bool:
    """Always False: there is no ESP-NOW support in this repository yet."""
    return False
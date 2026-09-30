"""Transport layer: the seam where `EspNowTransport` will replace the simulator.

Application code depends on `Transport` (the protocol) and on `Frame` for routing
metadata. It never depends on `SimulatedMedium`, which is only the current
implementation of the link and the fault injector.
"""

from .base import MAX_ENDPOINT_ID_LENGTH, EndpointId, LinkUnavailable, Transport
from .envelope import (
    FRAME_KINDS,
    HEADER_FIELDS,
    KIND_ACK,
    KIND_DATA,
    MAX_HEADER_LENGTH,
    MAX_HOPS,
    MAX_PAYLOAD_LENGTH,
    REQUIRED_HEADER_FIELDS,
    Frame,
    FrameError,
    is_valid_frame_bytes,
)
from .simulated import MediumStats, SimulatedMedium, SimulatedTransport

__all__ = [
    "FRAME_KINDS",
    "HEADER_FIELDS",
    "KIND_ACK",
    "KIND_DATA",
    "MAX_ENDPOINT_ID_LENGTH",
    "MAX_HEADER_LENGTH",
    "MAX_HOPS",
    "MAX_PAYLOAD_LENGTH",
    "REQUIRED_HEADER_FIELDS",
    "EndpointId",
    "Frame",
    "FrameError",
    "LinkUnavailable",
    "MediumStats",
    "SimulatedMedium",
    "SimulatedTransport",
    "Transport",
    "is_valid_frame_bytes",
]
"""Frame envelope: routing metadata around an opaque payload.

The envelope carries only what a radio needs to move a frame — who sent it, who
should end up with it, which message it is, and how far it has travelled. The
payload is opaque to the transport: for telemetry it is exactly the
`TelemetryPacketV1` bytes from `shared/protocol`, unmodified.

Keeping these two layers separate is the point. A relay forwards frames without
ever parsing a vital sign, and the protocol layer does not know or care which
radio carried it.

Wire format, compact and length-checked:

    [4 bytes big-endian header length][header JSON, UTF-8][payload bytes]
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

# Bounds so a corrupted frame cannot allocate unbounded memory (Rules section 9).
MAX_HEADER_LENGTH = 512
MAX_PAYLOAD_LENGTH = 1_024
MAX_HOPS = 8

# Stable rejection reasons, mirroring the protocol layer's error-code approach.
NOT_BYTES = "NOT_BYTES"
TRUNCATED_FRAME = "TRUNCATED_FRAME"
OVERSIZED_HEADER = "OVERSIZED_HEADER"
OVERSIZED_PAYLOAD = "OVERSIZED_PAYLOAD"
MALFORMED_HEADER = "MALFORMED_HEADER"
UNKNOWN_HEADER_FIELD = "UNKNOWN_HEADER_FIELD"
MISSING_HEADER_FIELD = "MISSING_HEADER_FIELD"
INVALID_ENDPOINT = "INVALID_ENDPOINT"
INVALID_MESSAGE_ID = "INVALID_MESSAGE_ID"
INVALID_HOP_COUNT = "INVALID_HOP_COUNT"
HOP_LIMIT_EXCEEDED = "HOP_LIMIT_EXCEEDED"

HEADER_FIELDS = ("source", "destination", "message_id", "hop_count")


class FrameError(ValueError):
    """Raised when a frame cannot be framed, parsed, or routed safely."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def _check_endpoint(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 32:
        raise FrameError(f"{field} must be a short non-empty string", INVALID_ENDPOINT)
    return value


@dataclass(frozen=True)
class Frame:
    """One unit of transmission: routing header plus opaque payload."""

    source: str
    destination: str
    message_id: str
    payload: bytes
    hop_count: int = 0

    def __post_init__(self) -> None:
        _check_endpoint(self.source, "source")
        _check_endpoint(self.destination, "destination")
        if not isinstance(self.message_id, str) or not self.message_id:
            raise FrameError("message_id must be a non-empty string", INVALID_MESSAGE_ID)
        if len(self.message_id) > 128:
            raise FrameError("message_id is too long", INVALID_MESSAGE_ID)
        if not isinstance(self.payload, bytes):
            raise FrameError("payload must be bytes", NOT_BYTES)
        if len(self.payload) > MAX_PAYLOAD_LENGTH:
            raise FrameError("payload exceeds the maximum frame size", OVERSIZED_PAYLOAD)

    @property
    def frame_id(self) -> str:
        """Stable identity of this frame; unchanged when a relay forwards it."""
        return self.message_id

    def forwarded_by(self, relay_id: str) -> "Frame":
        """Return the same frame after one relay hop.

        The source, destination, and message identity are preserved so the
        gateway can still deduplicate; only `hop_count` (and the fact that this
        frame is now headed onward) changes.
        """
        if self.hop_count + 1 > MAX_HOPS:
            raise FrameError("hop limit exceeded", HOP_LIMIT_EXCEEDED)
        return Frame(
            source=self.source,
            destination=self.destination,
            message_id=self.message_id,
            payload=self.payload,
            hop_count=self.hop_count + 1,
        )

    def to_bytes(self) -> bytes:
        header = json.dumps(
            {
                "source": self.source,
                "destination": self.destination,
                "message_id": self.message_id,
                "hop_count": self.hop_count,
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        if len(header) > MAX_HEADER_LENGTH:
            raise FrameError("header exceeds the maximum size", OVERSIZED_HEADER)
        return len(header).to_bytes(4, "big") + header + self.payload

    @classmethod
    def from_bytes(cls, raw: bytes) -> "Frame":
        if not isinstance(raw, (bytes, bytearray)):
            raise FrameError("frame must be bytes", NOT_BYTES)
        raw = bytes(raw)
        if len(raw) < 4:
            raise FrameError("frame is too short to contain a header length", TRUNCATED_FRAME)

        header_length = int.from_bytes(raw[:4], "big")
        if header_length > MAX_HEADER_LENGTH:
            raise FrameError("header length exceeds the maximum", OVERSIZED_HEADER)
        if len(raw) < 4 + header_length:
            raise FrameError("frame is shorter than its declared header", TRUNCATED_FRAME)

        header_bytes = raw[4 : 4 + header_length]
        payload = raw[4 + header_length :]
        if len(payload) > MAX_PAYLOAD_LENGTH:
            raise FrameError("payload exceeds the maximum frame size", OVERSIZED_PAYLOAD)

        try:
            header = json.loads(header_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise FrameError("header is not valid UTF-8 JSON", MALFORMED_HEADER) from exc
        if not isinstance(header, dict):
            raise FrameError("header must be an object", MALFORMED_HEADER)

        unknown = set(header) - set(HEADER_FIELDS)
        if unknown:
            raise FrameError(f"unknown header fields: {sorted(unknown)}", UNKNOWN_HEADER_FIELD)
        missing = set(HEADER_FIELDS) - set(header)
        if missing:
            raise FrameError(f"missing header fields: {sorted(missing)}", MISSING_HEADER_FIELD)

        hop_count = header["hop_count"]
        if isinstance(hop_count, bool) or not isinstance(hop_count, int) or hop_count < 0:
            raise FrameError("hop_count must be a non-negative integer", INVALID_HOP_COUNT)
        if hop_count > MAX_HOPS:
            raise FrameError("hop limit exceeded", HOP_LIMIT_EXCEEDED)

        return cls(
            source=header["source"],
            destination=header["destination"],
            message_id=header["message_id"],
            payload=payload,
            hop_count=hop_count,
        )


def is_valid_frame_bytes(raw: bytes) -> bool:
    """True when `raw` parses as a frame; used to describe faults in tests."""
    try:
        Frame.from_bytes(raw)
    except FrameError:
        return False
    return True
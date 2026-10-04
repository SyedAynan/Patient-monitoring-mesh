"""Message authentication codes for frames.

HMAC-SHA256 over the frame's *immutable* fields: the fields that must not
change between sender and receiver for the message to mean the same thing.

Covered by the MAC (immutable):
- source, destination, message_id — routing identity
- payload bytes — the telemetry itself

Deliberately NOT covered (mutable per hop):
- hop_count, last_hop — legitimately change as a relay forwards the frame
- kind/acks — set by the ack builder, verified separately if needed

So a relay can forward without breaking the MAC, but tampering with the payload
or impersonating another source breaks it. The gateway is the enforcement point
(`docs/Architecture.md` section 8): validate before accept.

Key handling rules (Rules section 10):
- Secrets are never in exceptions, never in `repr`, never logged by this module.
- Comparison is constant-time (`hmac.compare_digest`) — no early-exit oracle.
- Failure is a boolean outcome plus a reason code, not a detailed error string
  an attacker could mine.
"""

from __future__ import annotations

import hashlib
import hmac

# hex-encoded SHA-256 digest length.
MAC_HEX_LENGTH = 64
MAC_LENGTH = 32

# Rejection reason codes (stable, machine-readable, like the protocol's).
MAC_MISSING = "MAC_MISSING"
MAC_INVALID_FORMAT = "MAC_INVALID_FORMAT"
MAC_MISMATCH = "MAC_MISMATCH"


def compute_frame_mac(
    *,
    source: str,
    destination: str,
    message_id: str,
    payload: bytes,
    key: bytes,
) -> str:
    """Compute the hex MAC for a frame's immutable fields.

    The input is unambiguous: length-prefixed field concatenation, so no two
    distinct field tuples produce the same bytes.
    """
    mac = hmac.new(key, digestmod=hashlib.sha256)
    for field in (source.encode("utf-8"), destination.encode("utf-8"), message_id.encode("utf-8")):
        mac.update(len(field).to_bytes(4, "big"))
        mac.update(field)
    mac.update(len(payload).to_bytes(4, "big"))
    mac.update(payload)
    return mac.hexdigest()


def verify_frame_mac(
    *,
    source: str,
    destination: str,
    message_id: str,
    payload: bytes,
    key: bytes,
    presented_mac: str | None,
) -> tuple[bool, str | None]:
    """Verify a presented MAC against the frame's immutable fields.

    Returns (True, None) on success, (False, reason_code) otherwise. Constant
    time; no exception carries key material.
    """
    if presented_mac is None:
        return False, MAC_MISSING
    if not isinstance(presented_mac, str) or len(presented_mac) != MAC_HEX_LENGTH:
        return False, MAC_INVALID_FORMAT
    try:
        presented = bytes.fromhex(presented_mac)
    except ValueError:
        return False, MAC_INVALID_FORMAT
    if len(presented) != MAC_LENGTH:
        return False, MAC_INVALID_FORMAT

    expected = compute_frame_mac(
        source=source,
        destination=destination,
        message_id=message_id,
        payload=payload,
        key=key,
    )
    if hmac.compare_digest(bytes.fromhex(expected), presented):
        return True, None
    return False, MAC_MISMATCH


def is_valid_mac_format(mac: str | None) -> bool:
    """Cheap format check without a key; used for envelope validation."""
    if mac is None:
        return True
    if not isinstance(mac, str) or len(mac) != MAC_HEX_LENGTH:
        return False
    try:
        bytes.fromhex(mac)
    except ValueError:
        return False
    return True

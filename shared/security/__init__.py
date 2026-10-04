"""Shared security: MAC and device credentials.

Imported by the gateway (verification) and by nodes/relay signing paths, the
same way `shared.risk` is shared: one implementation, no drift possible.
"""

from .mac import (
    MAC_LENGTH,
    compute_frame_mac,
    verify_frame_mac,
)
from .credentials import (
    DeviceCredential,
    DeviceCredentialStore,
    VerificationOutcome,
)

__all__ = [
    "MAC_LENGTH",
    "DeviceCredential",
    "DeviceCredentialStore",
    "VerificationOutcome",
    "compute_frame_mac",
    "verify_frame_mac",
]

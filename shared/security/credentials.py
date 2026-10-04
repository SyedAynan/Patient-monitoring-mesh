"""Provisioned device credentials: who is allowed to speak on this mesh.

The gateway consults a `DeviceCredentialStore` before trusting a frame. Fail
closed: an unknown, revoked, or wrongly keyed device is rejected — never
accepted with a warning (Rules section 12).

Secrets live in memory only. Nothing in this module persists a key or writes
one to a log; provisioning in this lab prototype uses either a per-device
secret or a single master key from the environment. Rotation replaces the key
under the same device id: old frames fail immediately after rotation, which is
the intended revocation semantics.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .mac import verify_frame_mac

# Stable outcome codes for stats/audit.
OK = "OK"
UNKNOWN_DEVICE = "UNKNOWN_DEVICE"
REVOKED = "REVOKED"
MAC_REJECTED = "MAC_REJECTED"


@dataclass(frozen=True)
class DeviceCredential:
    """One provisioned device. Holds the key in memory; never persisted."""

    device_id: str
    key: bytes
    revoked: bool = False


@dataclass(frozen=True)
class VerificationOutcome:
    """Result of authenticating one frame at the gateway."""

    accepted: bool
    reason: str

    @property
    def ok(self) -> bool:
        return self.accepted


class DeviceCredentialStore:
    """In-memory credential registry: provision, revoke, rotate, verify."""

    def __init__(self, master_key: bytes | None = None) -> None:
        # Master key: devices provisioned without their own secret use it.
        # Passing None disables that fallback entirely (strict per-device keys).
        self._master_key = master_key
        self._credentials: dict[str, DeviceCredential] = {}

    # -- provisioning ----------------------------------------------------

    def provision(self, device_id: str, key: bytes | None = None) -> None:
        """Register a device. `key=None` means "master key device"."""
        if not device_id:
            raise ValueError("device_id must be non-empty")
        if key is not None and not isinstance(key, bytes):
            raise TypeError("key must be bytes or None")
        effective = key if key is not None else None
        self._credentials[device_id] = DeviceCredential(
            device_id=device_id, key=effective, revoked=False
        )

    def revoke(self, device_id: str) -> bool:
        """Revoke a device; its frames fail verification from now on."""
        credential = self._credentials.get(device_id)
        if credential is None or credential.revoked:
            return False
        self._credentials[device_id] = DeviceCredential(
            device_id=credential.device_id, key=credential.key, revoked=True
        )
        return True

    def rotate(self, device_id: str, new_key: bytes) -> bool:
        """Replace a device's key. Old frames immediately fail."""
        credential = self._credentials.get(device_id)
        if credential is None:
            return False
        self._credentials[device_id] = DeviceCredential(
            device_id=device_id, key=new_key, revoked=credential.revoked
        )
        return True

    def is_known(self, device_id: str) -> bool:
        return device_id in self._credentials

    # -- verification ----------------------------------------------------

    def _key_for(self, device_id: str) -> bytes | None:
        credential = self._credentials.get(device_id)
        if credential is None:
            return None
        if credential.key is not None:
            return credential.key
        return self._master_key

    def verify(
        self,
        *,
        source: str,
        destination: str,
        message_id: str,
        payload: bytes,
        presented_mac: str | None,
    ) -> VerificationOutcome:
        """Authenticate one frame. Fail closed on every failure mode."""
        credential = self._credentials.get(source)
        if credential is None:
            return VerificationOutcome(False, UNKNOWN_DEVICE)
        if credential.revoked:
            return VerificationOutcome(False, REVOKED)

        key = self._key_for(source)
        if key is None:
            # Provisioned as a master-key device but no master key was given:
            # fail closed rather than accept unauthenticated.
            return VerificationOutcome(False, MAC_REJECTED)

        valid, reason = verify_frame_mac(
            source=source,
            destination=destination,
            message_id=message_id,
            payload=payload,
            key=key,
            presented_mac=presented_mac,
        )
        if not valid:
            # reason is a stable code (MAC_MISSING / MAC_INVALID_FORMAT /
            # MAC_MISMATCH), safe to surface — it never contains key material.
            return VerificationOutcome(False, reason)
        return VerificationOutcome(True, OK)

    # -- introspection for stats/tests (never exposes keys) ----------------

    def device_ids(self) -> list[str]:
        return sorted(self._credentials)

    def summary(self) -> dict[str, object]:
        """Counts only — deliberately unhelpful to an attacker."""
        total = len(self._credentials)
        revoked = sum(1 for c in self._credentials.values() if c.revoked)
        return {"devices": total, "revoked": revoked, "master_key": self._master_key is not None}

"""Operator authentication and audit events for the backend.

The dashboard authentication decision (Phase 7, PRD section 11): this lab
prototype runs in **lab mode by default** — no login — matching the PRD's
"full login is deferred" stance. One mutating action class exists (alert
acknowledgement), and it now requires an operator token when auth is enabled.

Modes, selected by `BACKEND_AUTH_MODE`:

- `lab` (default): everything readable, mutations open. Same as before —
  nothing breaks for local demos or tests.
- `token`: reads open, mutations require the `X-Operator-Token` header to match
  `OPERATOR_TOKEN`. Comparison is constant-time. Wrong token → 401 with the
  standard envelope error shape.

Token handling rules (Rules section 10/20):
- Secrets come from the environment only; never a default in code that would
  look like a real secret; never logged; never returned by any endpoint.
- A token-mode deployment without `OPERATOR_TOKEN` set fails closed: every
  mutation is refused (the operator has not completed configuration).
"""

from __future__ import annotations

import hmac
import os
import time
import uuid
from dataclasses import dataclass

LAB_MODE = "lab"
TOKEN_MODE = "token"
AUTH_MODES = (LAB_MODE, TOKEN_MODE)


def current_auth_mode() -> str:
    mode = os.environ.get("BACKEND_AUTH_MODE", LAB_MODE).strip().lower()
    if mode not in AUTH_MODES:
        # Unknown configuration fails closed into the stricter mode.
        return TOKEN_MODE
    return mode


def operator_token() -> str | None:
    """The configured operator token, or None when unset."""
    token = os.environ.get("OPERATOR_TOKEN")
    if token is None or not token.strip():
        return None
    return token


@dataclass(frozen=True)
class AuthDecision:
    """Result of checking one mutating request."""

    allowed: bool
    reason: str  # OK | NOT_CONFIGURED | MISSING_TOKEN | WRONG_TOKEN


def check_mutation(token_presented: str | None) -> AuthDecision:
    """Decide whether a mutating request may proceed. Fails closed."""
    mode = current_auth_mode()
    if mode == LAB_MODE:
        return AuthDecision(True, "OK")

    expected = operator_token()
    if expected is None:
        # Token mode with no token configured: refuse everything, because the
        # operator has not finished setting up and accepting silently would be
        # the opposite of fail-closed.
        return AuthDecision(False, "NOT_CONFIGURED")
    if token_presented is None:
        return AuthDecision(False, "MISSING_TOKEN")
    if not hmac.compare_digest(expected.encode("utf-8"), token_presented.encode("utf-8")):
        return AuthDecision(False, "WRONG_TOKEN")
    return AuthDecision(True, "OK")


def auth_mode_for_health() -> str:
    """What /health reports. Never includes the token or its length."""
    mode = current_auth_mode()
    if mode == TOKEN_MODE and operator_token() is None:
        return f"{TOKEN_MODE} (not configured — mutations refused)"
    return mode


# ---------------------------------------------------------------------------
# Audit events
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AuditEvent:
    """One security-relevant action, recorded for the audit trail."""

    event_id: str
    action: str  # e.g. "alert_acknowledge", "device_revoke", "auth_reject"
    actor: str  # "operator" | "system" | a device id
    target: str  # what was acted on (alert id, device id, route)
    outcome: str  # OK or a reason code
    at_ms: int
    detail: str = ""

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "action": self.action,
            "actor": self.actor,
            "target": self.target,
            "outcome": self.outcome,
            "at_ms": self.at_ms,
            "detail": self.detail,
        }


def make_audit_event(
    *, action: str, actor: str, target: str, outcome: str, detail: str = ""
) -> AuditEvent:
    return AuditEvent(
        event_id=str(uuid.uuid4()),
        action=action,
        actor=actor,
        target=target,
        outcome=outcome,
        at_ms=int(time.time() * 1000),
        detail=detail,
    )

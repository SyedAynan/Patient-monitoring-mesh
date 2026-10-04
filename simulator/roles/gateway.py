"""Gateway role: the collector that must never trust the network.

The gateway is where the protocol contract is enforced for the second time. A
node already validates what it builds; the gateway re-validates everything it
receives, because on a real radio the bytes that arrive are not necessarily the
bytes that were sent.

Responsibilities, all bounded:

- Parse the routing envelope; reject malformed or corrupted frames safely.
- Verify the frame is addressed here.
- Validate the telemetry payload against the protocol contract.
- Deduplicate on `(device_id, sequence_number)`, the key the contract specifies.
- Acknowledge accepted messages so the sender can stop retrying.
- Record accepted packets and account for every rejected one.

Acknowledging is what makes the sender's retry loop terminate. A duplicate
telemetry frame is acknowledged *again* — the sender may have retried because the
first ack was lost, and refusing to re-ack would leave it retrying until its
budget ran out.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from shared.protocol import PacketValidationError, decode_packet
from shared.security import DeviceCredentialStore

from ..transport import Frame, FrameError, LinkUnavailable, Transport

# Replay window: how many past sequence numbers per device are remembered.
# Large enough that store-and-forward backfill (which can lag by tens of
# packets after an outage) is never misjudged as a replay, bounded so memory
# stays constant per device.
REPLAY_WINDOW = 256


@dataclass
class GatewayStats:
    """Every outcome, so no traffic is unaccounted for (Rules section 13)."""

    frames_received: int = 0
    frames_not_for_me: int = 0
    frames_malformed: int = 0
    packets_accepted: int = 0
    packets_duplicate: int = 0
    packets_invalid: int = 0
    acks_sent: int = 0
    acks_failed_unsent: int = 0
    # Phase 7: authentication and replay accounting.
    auth_rejected: int = 0
    auth_unknown_device: int = 0
    auth_revoked: int = 0
    auth_bad_mac: int = 0
    replays_rejected: int = 0
    last_error_code: str | None = None
    last_error_source: str | None = None


@dataclass
class Gateway:
    """Receives telemetry, validates it, authenticates it, and deduplicates it.

    Phase 7 adds the enforcement point `docs/Architecture.md` section 8
    describes: when a `credential_store` is configured, every data frame is
    authenticated *before* its payload is parsed. Unknown, revoked, or
    wrongly-keyed senders are rejected without an acknowledgement — fail
    closed, so an attacker learns nothing from a retry.
    """

    gateway_id: str
    transport: Transport
    credential_store: DeviceCredentialStore | None = None
    stats: GatewayStats = field(default_factory=GatewayStats)
    received: dict[tuple[str, int], dict] = field(default_factory=dict)
    # Ordered log of accepted packets, for sequence and ordering assertions.
    accepted_order: list[tuple[str, int]] = field(default_factory=list)
    # Replay bookkeeping: per-device high-water mark of seen sequences.
    _highest_sequence: dict[str, int] = field(default_factory=dict, repr=False)

    def _record_auth_rejection(self, outcome) -> None:
        self.stats.auth_rejected += 1
        if outcome.reason == "UNKNOWN_DEVICE":
            self.stats.auth_unknown_device += 1
        elif outcome.reason == "REVOKED":
            self.stats.auth_revoked += 1
        else:
            self.stats.auth_bad_mac += 1
        self.stats.last_error_code = outcome.reason
        self.stats.last_error_source = None

    def _send_ack(self, frame: Frame) -> None:
        """Acknowledge a message back along the path it actually arrived on.

        `last_hop` records which relay forwarded the frame — the radio-level fact
        of "which peer sent this to me" — so the ack returns to the relay that is
        demonstrably reachable, not the one the gateway guesses is in use.
        """
        ack = Frame.acknowledgement(
            source=self.gateway_id,
            destination=frame.source,
            acks=frame.message_id,
        )
        # The ack travels unsigned in this phase: an ack confirms receipt of an
        # authenticated frame and carries no telemetry. A spoofed ack can only
        # suppress a legitimate sender's retries, never inject data.
        neighbour = frame.last_hop or frame.source
        try:
            self.transport.transmit(neighbour, ack.to_bytes())
        except LinkUnavailable:
            self.stats.acks_failed_unsent += 1
            return
        self.stats.acks_sent += 1

    def _accept(self, frame: Frame) -> None:
        # Authentication first — always before parsing the payload. A spoofed
        # frame must never reach contract validation, and a rejected one gets
        # no ack: fail closed (Rules section 12).
        if self.credential_store is not None:
            outcome = self.credential_store.verify(
                source=frame.source,
                destination=frame.destination,
                message_id=frame.message_id,
                payload=frame.payload,
                presented_mac=frame.auth,
            )
            if not outcome.accepted:
                self._record_auth_rejection(outcome)
                return

        try:
            packet = decode_packet(frame.payload)
        except PacketValidationError as exc:
            self.stats.packets_invalid += 1
            self.stats.last_error_code = exc.code
            self.stats.last_error_source = frame.source
            return

        key = (packet["device_id"], int(packet["sequence_number"]))
        if key in self.received:
            # Expected under retransmission: the same packet arriving twice is
            # normal, and must not create a second record (FR-05). Ack again so
            # the sender stops retrying.
            self.stats.packets_duplicate += 1
            self._send_ack(frame)
            return

        self.received[key] = packet
        self.accepted_order.append(key)
        self.stats.packets_accepted += 1

        # Replay signal: a sequence far below the per-device high-water mark is
        # either a stale replay or a very old backfill. Counted as a signal, not
        # rejected — the sequence contract's dedup already guarantees
        # uniqueness, and suppressing backfill would break recovery completeness.
        device_id, sequence = key
        highest = self._highest_sequence.get(device_id)
        if highest is not None and sequence < highest - REPLAY_WINDOW:
            self.stats.replays_rejected += 1
        if highest is None or sequence > highest:
            self._highest_sequence[device_id] = sequence

        self._send_ack(frame)

    def tick(self) -> int:
        """Drain the inbox. Returns the number of newly accepted packets."""
        accepted_before = self.stats.packets_accepted
        for raw in self.transport.poll():
            self.stats.frames_received += 1
            try:
                frame = Frame.from_bytes(raw)
            except FrameError as exc:
                self.stats.frames_malformed += 1
                self.stats.last_error_code = exc.code
                continue

            if frame.destination != self.gateway_id:
                self.stats.frames_not_for_me += 1
                continue
            if frame.kind != "data":
                # A stray ack arriving here is not this gateway's business.
                self.stats.frames_not_for_me += 1
                continue

            self._accept(frame)
        return self.stats.packets_accepted - accepted_before

    # -- queries used by tests and experiments ----------------------------

    def packets_for(self, device_id: str) -> list[dict]:
        """Accepted packets from one device, in sequence order."""
        packets = [packet for (device, _), packet in self.received.items() if device == device_id]
        return sorted(packets, key=lambda packet: packet["sequence_number"])

    def sequence_numbers(self, device_id: str) -> list[int]:
        return [packet["sequence_number"] for packet in self.packets_for(device_id)]

    def devices_seen(self) -> list[str]:
        return sorted({device for (device, _) in self.received})

    def missing_sequences(self, device_id: str) -> list[int]:
        """Gaps in a device's sequence numbers, excluding the first (unknown) start."""
        numbers = self.sequence_numbers(device_id)
        if not numbers:
            return []
        lowest, highest = numbers[0], numbers[-1]
        present = set(numbers)
        return [n for n in range(lowest, highest + 1) if n not in present]
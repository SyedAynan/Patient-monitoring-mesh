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

from ..transport import Frame, FrameError, LinkUnavailable, Transport


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
    last_error_code: str | None = None
    last_error_source: str | None = None


@dataclass
class Gateway:
    """Receives telemetry, validates it, acknowledges it, and deduplicates it."""

    gateway_id: str
    transport: Transport
    stats: GatewayStats = field(default_factory=GatewayStats)
    received: dict[tuple[str, int], dict] = field(default_factory=dict)
    # Ordered log of accepted packets, for sequence and ordering assertions.
    accepted_order: list[tuple[str, int]] = field(default_factory=list)

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
        neighbour = frame.last_hop or frame.source
        try:
            self.transport.transmit(neighbour, ack.to_bytes())
        except LinkUnavailable:
            self.stats.acks_failed_unsent += 1
            return
        self.stats.acks_sent += 1

    def _accept(self, frame: Frame) -> None:
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
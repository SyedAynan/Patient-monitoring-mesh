"""Phase 1 feasibility spike: the packet path a node and gateway must implement.

This is a deterministic stand-in for the physical two-node transport spike, which
cannot run in this workspace (see simulator/README.md). It exercises the rules the
v1 contract already claims: retries reuse (device_id, sequence_number), the
receiver deduplicates on that key, corrupted bytes are rejected safely, and a
node buffer stays inside its bound during an outage.

Duplicates are produced the way they happen on a real link: the frame arrives but
its acknowledgement is lost, so the sender retries and the receiver sees the same
packet twice. A retry after a drop would never reach the receiver at all.

Standard library only, fixed seed, no hardware, no timing claims.
"""

from __future__ import annotations

import json
import random
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.protocol import (  # noqa: E402
    PacketValidationError,
    decode_packet,
    encode_packet,
    make_packet,
)

SEED = 20260928
SAMPLES_PER_NODE = 40
DROPOUT_RATE = 0.20
CORRUPTION_RATE = 0.05
ACK_LOSS_RATE = 0.15
MAX_ATTEMPTS = 6
BUFFER_LIMIT = 12
OUTAGE_STEPS = range(12, 21)
BASE_CAPTURED_AT_MS = 1_798_000_000_000
SAMPLE_INTERVAL_MS = 1_000

NODES = (("node-01", "patient-01"), ("node-02", "patient-02"))

DROPPED = "dropped"
CORRUPTED = "corrupted"
ACK_LOST = "ack_lost"
ACKED = "acked"


@dataclass
class Link:
    """A lossy link: frames may drop, corrupt, or arrive with a lost ack."""

    rng: random.Random
    down: bool = False
    dropped: int = 0
    corrupted: int = 0
    ack_lost: int = 0

    def transmit(self, frame: bytes, receiver: "Receiver") -> str:
        if self.down or self.rng.random() < DROPOUT_RATE:
            self.dropped += 1
            return DROPPED
        if self.rng.random() < CORRUPTION_RATE:
            self.corrupted += 1
            receiver.deliver(b"\xff\xfe" + frame[2:])
            return CORRUPTED
        # The receiver stores or suppresses it; a suppressed frame is a retry
        # whose earlier copy was already accepted, which is exactly what the
        # sequence-number key is supposed to catch.
        receiver.deliver(frame)
        if self.rng.random() < ACK_LOSS_RATE:
            self.ack_lost += 1
            return ACK_LOST
        return ACKED


@dataclass
class Receiver:
    """Deduplicates by (device_id, sequence_number) and rejects junk safely."""

    received: dict[tuple[str, int], dict] = field(default_factory=dict)
    duplicates_suppressed: int = 0
    rejected: int = 0

    def deliver(self, frame: bytes) -> bool:
        try:
            packet = decode_packet(frame)
        except PacketValidationError:
            self.rejected += 1
            return False
        key = (packet["device_id"], packet["sequence_number"])
        if key in self.received:
            self.duplicates_suppressed += 1
            return False
        self.received[key] = packet
        return True


@dataclass
class Node:
    """A node with a bounded buffer of undelivered frames."""

    device_id: str
    patient_id: str
    buffer: list[tuple[str, int, bytes]] = field(default_factory=list)
    refusals: int = 0
    high_water: int = 0

    def enqueue(self, sequence_number: int, frame: bytes) -> None:
        if len(self.buffer) >= BUFFER_LIMIT:
            self.refusals += 1
            return
        self.buffer.append((self.device_id, sequence_number, frame))
        self.high_water = max(self.high_water, len(self.buffer))


@dataclass
class Stats:
    acked: int = 0
    retransmissions: int = 0
    failed: int = 0
    retry_keys: list[tuple[str, int]] = field(default_factory=list)
    corrupt_sent: int = 0


def build_sample(device_id: str, patient_id: str, sequence_number: int) -> tuple[dict, bytes]:
    """Build and encode one sample at the packet-contract boundary."""
    packet = make_packet(
        device_id=device_id,
        patient_id=patient_id,
        sequence_number=sequence_number,
        captured_at_ms=BASE_CAPTURED_AT_MS + sequence_number * SAMPLE_INTERVAL_MS,
        heart_rate_bpm=70 + sequence_number % 12,
        spo2_percent=97,
        temperature_c=36.6,
        signal_quality=0.95,
        risk_level="normal",
        risk_score=5,
    )
    return packet, encode_packet(packet)


def send(
    link: Link,
    receiver: Receiver,
    stats: Stats,
    key: tuple[str, int],
    frame: bytes,
) -> bool:
    """Transmit one frame with bounded retries; True when an ack was received."""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if attempt > 1:
            stats.retransmissions += 1
            stats.retry_keys.append(key)
        outcome = link.transmit(frame, receiver)
        if outcome in (DROPPED, CORRUPTED):
            continue
        if outcome == ACKED:
            stats.acked += 1
            return True
        # ACK_LOST: the frame was stored but the sender does not know yet.
    stats.failed += 1
    return False


def run_spike() -> dict[str, object]:
    rng = random.Random(SEED)
    link = Link(rng=rng)
    receiver = Receiver()
    stats = Stats()
    nodes = [Node(device_id=d, patient_id=p) for d, p in NODES]
    emitted: dict[tuple[str, int], dict] = {}

    for step in range(1, SAMPLES_PER_NODE + 1):
        link.down = step in OUTAGE_STEPS
        for node in nodes:
            packet, frame = build_sample(node.device_id, node.patient_id, step)
            emitted[(node.device_id, step)] = packet
            if not send(link, receiver, stats, (node.device_id, step), frame):
                node.enqueue(step, frame)

    # Reconnect: every node flushes its buffer once the link recovers.
    link.down = False
    for node in nodes:
        buffered = list(node.buffer)
        node.buffer.clear()
        for _, sequence_number, buffered_frame in buffered:
            if not send(
                link,
                receiver,
                stats,
                (node.device_id, sequence_number),
                buffered_frame,
            ):
                node.enqueue(sequence_number, buffered_frame)

    return {
        "emitted_count": len(emitted),
        "emitted_samples": emitted,
        "acked": stats.acked,
        "unique_records": len(receiver.received),
        "retransmissions": stats.retransmissions,
        "retry_keys": stats.retry_keys,
        "duplicates_suppressed": receiver.duplicates_suppressed,
        "rejected": receiver.rejected,
        "dropped_frames": link.dropped,
        "corrupted_frames": link.corrupted,
        "ack_lost": link.ack_lost,
        "failed_after_reconnect": stats.failed,
        "buffered_remaining": sum(len(n.buffer) for n in nodes),
        "buffer_limit": BUFFER_LIMIT,
        "buffer_high_water": max(n.high_water for n in nodes),
        "buffer_refusals": sum(n.refusals for n in nodes),
        "encoded_bytes": len(encode_packet(emitted[("node-01", 1)])),
        "receiver": receiver,
    }


def check_records_are_faithful(result: dict[str, object]) -> tuple[bool, str]:
    """Every stored record must equal the sample the node actually emitted."""
    receiver = result["receiver"]
    emitted = result["emitted_samples"]
    assert isinstance(receiver, Receiver) and isinstance(emitted, dict)
    for key, stored in receiver.received.items():
        if emitted.get(key) != stored:
            return False, f"stored record {key} does not match the emitted sample"
    return True, ""


def main() -> int:
    result = run_spike()
    emitted = result["emitted_samples"]
    assert isinstance(emitted, dict)

    retry_keys = result["retry_keys"]
    assert isinstance(retry_keys, list)
    unique_retry_keys = set(retry_keys)

    checks = [
        (
            "every emitted sample encodes and decodes through the link",
            result["unique_records"] == len(emitted)
            and all(decode_packet(encode_packet(p)) == p for p in emitted.values()),
            f"emitted={len(emitted)} unique_records={result['unique_records']}",
        ),
        (
            "a retry reuses the same (device_id, sequence_number)",
            len(unique_retry_keys) < len(retry_keys),
            f"{len(retry_keys)} retries over {len(unique_retry_keys)} keys",
        ),
        (
            "duplicate retries were suppressed, not stored twice",
            isinstance(result["duplicates_suppressed"], int)
            and result["duplicates_suppressed"] > 0,
            "an ack-loss link must deliver the same packet more than once",
        ),
        (
            "stored records match the samples that were emitted",
            *check_records_are_faithful(result),
        ),
        (
            "corrupted frames were rejected safely",
            isinstance(result["rejected"], int) and result["rejected"] > 0,
            "corruption injection must reach the receiver as a rejected frame",
        ),
        (
            "node buffer stayed inside its bound during the outage",
            isinstance(result["buffer_high_water"], int)
            and result["buffer_high_water"] <= BUFFER_LIMIT,
            f"high water {result['buffer_high_water']} > limit {BUFFER_LIMIT}",
        ),
    ]

    print("Phase 1 feasibility spike (simulated link, not an evaluation metric)")
    print(f"seed={SEED} samples_per_node={SAMPLES_PER_NODE} nodes={len(NODES)}")
    print(f"encoded packet size: {result['encoded_bytes']} bytes")
    print(f"emitted={result['emitted_count']} acked={result['acked']} "
          f"unique_records={result['unique_records']}")
    print(f"retransmissions={result['retransmissions']} "
          f"duplicates_suppressed={result['duplicates_suppressed']} "
          f"rejected={result['rejected']}")
    print(f"dropped_frames={result['dropped_frames']} ack_lost={result['ack_lost']} "
          f"corrupted_frames={result['corrupted_frames']}")
    print(f"buffer_high_water={result['buffer_high_water']}/{BUFFER_LIMIT} "
          f"refusals={result['buffer_refusals']} "
          f"undelivered_after_reconnect={result['buffered_remaining']}")

    failures = 0
    for name, passed, detail in checks:
        suffix = f" -- {detail}" if detail and not passed else ""
        print(f"[{'PASS' if passed else 'FAIL'}] {name}{suffix}")
        if not passed:
            failures += 1

    print(json.dumps({"feasibility_checks_failed": failures}, sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
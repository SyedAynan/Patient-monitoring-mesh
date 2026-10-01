"""Priority queue and bounded retry policy.

Two guarantees this module exists to provide, both from `Rules.md` section 9:

1. **Routine traffic never starves critical alerts.** Draining is
   critical-first, and routine frames are only sent when no critical frame is
   waiting at all.
2. **The queue is bounded.** A buffer that grows without limit is a memory bug
   waiting for a long demo, so admission is capped and refusals are counted.

Retries reuse the same `(device_id, sequence_number)` / `message_id`, per the
protocol's reliability rules; a retry is the same message, not a new one.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from ..transport import Frame

PRIORITY_CRITICAL = "critical"
PRIORITY_ROUTINE = "routine"
PRIORITY_ORDER = (PRIORITY_CRITICAL, PRIORITY_ROUTINE)
# Lower number = sent earlier. Used for sorting and for explanation in the UI.
PRIORITY_RANK = {PRIORITY_CRITICAL: 0, PRIORITY_ROUTINE: 1}


@dataclass
class PendingFrame:
    """One message awaiting transmission or acknowledgement."""

    frame: Frame
    priority: str
    attempts: int = 0
    acked: bool = False
    # Telemetry sequence number when this frame carries a telemetry packet.
    # Retries reuse it, which is what licenses gateway deduplication.
    sequence_number: int | None = None

    @property
    def message_id(self) -> str:
        return self.frame.message_id


@dataclass
class PriorityQueue:
    """Bounded, critical-first queue of frames awaiting transmission.

    `dropped` distinguishes the two ways a frame can fail to be admitted:
    a bound that refused it, and a retry budget that ran out. Both are counted
    so an experiment can account for every message.
    """

    capacity: int = 64
    _critical: deque[PendingFrame] = field(default_factory=deque, repr=False)
    _routine: deque[PendingFrame] = field(default_factory=deque, repr=False)
    # Refused at the bound, evicted to make room for an alert, and given up on
    # after exhausting the retry budget. Counted separately and never conflated.
    refused_capacity: int = 0
    evicted_for_priority: int = 0
    dropped_exhausted: int = 0

    def __post_init__(self) -> None:
        if self.capacity < 1:
            raise ValueError("capacity must be at least 1")

    def __len__(self) -> int:
        return len(self._critical) + len(self._routine)

    @property
    def depth(self) -> int:
        return len(self)

    @property
    def critical_depth(self) -> int:
        return len(self._critical)

    @property
    def routine_depth(self) -> int:
        return len(self._routine)

    def enqueue(self, frame: Frame, priority: str = PRIORITY_ROUTINE) -> bool:
        """Admit a frame. Returns False when the bound refuses it.

        A refused *critical* frame evicts the oldest *routine* frame if one is
        waiting, because a full buffer of routine telemetry must never be what
        keeps an alert off the wire. If only critical frames are queued, the
        newest critical frame is refused and counted rather than silently dropped.
        """
        if priority not in PRIORITY_ORDER:
            raise ValueError(f"priority must be one of {PRIORITY_ORDER}")

        if len(self) >= self.capacity:
            if priority == PRIORITY_CRITICAL and self._routine:
                # A routine frame loses its place so an alert can be carried.
                self._routine.popleft()
                self.evicted_for_priority += 1
            else:
                self.refused_capacity += 1
                return False

        pending = PendingFrame(frame=frame, priority=priority)
        if priority == PRIORITY_CRITICAL:
            self._critical.append(pending)
        else:
            self._routine.append(pending)
        return True

    def peek(self) -> PendingFrame | None:
        if self._critical:
            return self._critical[0]
        if self._routine:
            return self._routine[0]
        return None

    def next_to_send(self) -> PendingFrame | None:
        """The highest-priority frame awaiting transmission or retry."""
        if self._critical:
            return self._critical[0]
        if self._routine:
            return self._routine[0]
        return None

    def acknowledge(self, message_id: str) -> bool:
        """Remove a message after acknowledgement. Returns False if not pending.

        A duplicate acknowledgement is not an error: retries make it normal, and
        it must never remove a second queued message.
        """
        for queue in (self._critical, self._routine):
            for pending in queue:
                if pending.message_id == message_id:
                    queue.remove(pending)
                    return True
        return False

    def discard(self, pending: PendingFrame) -> None:
        """Remove a message from its queue after acknowledgement or giving up."""
        for queue in (self._critical, self._routine):
            try:
                queue.remove(pending)
                return
            except ValueError:
                continue

    def pending_messages(self) -> list[PendingFrame]:
        return list(self._critical) + list(self._routine)

    def priority_of(self, message_id: str) -> str | None:
        for pending in self.pending_messages():
            if pending.message_id == message_id:
                return pending.priority
        return None


@dataclass
class RetryPolicy:
    """Bounded retries with an explicit failure outcome.

    `max_attempts` counts the *first* transmission as attempt 1, so
    `max_attempts=3` means up to two retries. A message that exhausts the budget
    is reported as failed; it is never retried forever.
    """

    max_attempts: int = 3

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")

    def has_budget(self, attempts: int) -> bool:
        return attempts < self.max_attempts

    def describe(self) -> str:
        retries = self.max_attempts - 1
        return f"{self.max_attempts} attempts ({retries} retr{'y' if retries == 1 else 'ies'})"
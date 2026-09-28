# Simulator — stand-in for the Phase 1 hardware spike

**Status:** Phase 1 feasibility stand-in
**Date:** 2026-09-28

## Why this exists

The Phase 1 definition of done requires that "one node or simulator emits a
packet that decodes reliably". The physical two-node radio spike cannot run in
this workspace: no ESP32 boards are on hand and PlatformIO is not installed
(`docs/Memory.md` → Known issues; risks R-07 and R-08 in `docs/Risks.md`).

This directory is therefore the **documented fallback**, not a replacement. It
exercises the packet path that both the firmware and the future gateway must
implement, using the same authoritative validator as everything else
(`shared/protocol/telemetry_packet.py`).

`Rules.md` section 9 requires a simulator for every hardware-dependent packet
path, so this work stays in Phase 1 scope. Physical-radio behaviour is still
unverified and is not claimed anywhere.

## Scope

**In scope for Phase 1**

- Verify that packets survive encode → byte-level link → decode.
- Verify the retry rule: a retry keeps the same `(device_id, sequence_number)`.
- Verify the deduplication rule: retries never produce duplicate records.
- Verify that corrupted bytes are rejected safely rather than crashing a receiver.
- Verify a bounded buffer refuses to grow without limit.

**Explicitly not in scope** (later phases, and not simulated here)

- Priority queues, real acknowledgements over radio, routing, relaying,
  store-and-forward, and recovery — Phase 3 and Phase 4.
- Sensor reading, filtering, and signal quality — Phase 2.
- Persistence, the dashboard, and risk scoring — Phase 5 and Phase 6.
- Radio range, timing, and interference behaviour. A simulated link proves
  nothing about the radio; those numbers come only from the physical spike.

## Run it

Standard library only, deterministic, no hardware:

```bash
python simulator/feasibility_spike.py
```

The seed is fixed, so repeated runs produce identical output. Exit code `0`
means every feasibility check passed; `1` means at least one failed and the
output names it.

## Output

The script prints feasibility observations and the exit status. Per
`docs/Evaluation.md`, these are **not** evaluation metrics: they come from a
simulated link on a single clock and must never be reported as measured
network performance, delivery ratios, or latency results (M-01 … M-12).

## What the physical spike must still prove

When hardware is available (`docs/Phases.md` → Phase 1 remaining gate):

1. Two ESP32 boards exchange a real packet and the receiving side validates it.
2. The same packet bytes validate against `shared/protocol/` on the laptop.
3. One relay hop is possible at all — the open question R-01 in `docs/Risks.md`.
4. A measured observation of range and delivery under classroom conditions.

Until then, `docs/Memory.md` records the physical spike as unverified and the
Phase 1 gate stays open.
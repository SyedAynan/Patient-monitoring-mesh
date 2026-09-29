# Project Memory

**Last updated:** 2026-09-28
**Current phase:** Phase 1 — Project foundation and feasibility spike

## Completed

- Existing git-backed documentation baseline was preserved after the workspace changed during setup.
- Foundation docs are present: PRD, Architecture, Rules, Phases, Design.
- Phase 1 deliverables added: `docs/Evaluation.md` (metric definitions, experiment
  scenarios, evidence rules) and `docs/Risks.md` (risk register with triggers and
  fallbacks).
- Decisions selected: six target nodes; ESP-NOW-style local transport spike; Python/FastAPI backend; SQLite first; React + TypeScript later; lab-only dashboard mode initially; ECG deferred; dashboard alerts first.

## Current implementation

- Versioned `TelemetryPacketV1` contract in `shared/protocol/`.
- Standard-library validator, deterministic JSON encoder/decoder, packet builder.
- Demo script and unit tests; 21 tests pass (14 contract + 7 regression tests that
  drive `simulator/feasibility_spike.py`).
- Phase 1 simulator stand-in added: `simulator/feasibility_spike.py` plus
  `simulator/README.md`. Deterministic (fixed seed), standard library only,
  exit code signals pass/fail. Verified: 80/80 samples delivered, duplicate
  retries suppressed, corrupted frames rejected, buffer bounded, no growth.
- `.gitignore` and `.env.example` added without secrets.

## Important decisions

- No third-party dependencies in Phase 1.
- Packet retries reuse `(device_id, sequence_number)`.
- Critical and routine traffic are explicit priorities.
- Prototype uses synthetic/non-clinical data only.

## Known issues / TBD

- The physical Phase 1 gate is still open: no ESP32 boards and no PlatformIO
  toolchain in this workspace, so the two-node radio spike is unverified. The
  simulator stand-in exercises the packet path only; it says nothing about radio
  behavior, and no simulated number may be reported as a measured metric
  (`docs/Evaluation.md`).
- Final radio/mesh implementation needs hardware feasibility testing (risks R-01,
  R-02, R-07, R-08 in `docs/Risks.md`).
- Packet authentication/encryption is deferred to the security phase.
- Existing untracked `assets/hardware.png` was not modified.
- Unsolicited files appeared in the working tree during this phase and were not
  reviewed or endorsed: `Project_Completion_Report.md`. Its Phase 1 status wording
  is looser than the actual phase gate — treat `docs/Phases.md` as authoritative.
  It should be reviewed, corrected, or removed rather than published as-is.

## Next task

Acquire/confirm two ESP32 boards and begin the two-node transport spike; keep the simulator as the fallback until PlatformIO is available. That spike is what closes Phase 1 — do not start Phase 2 sensing work before it.

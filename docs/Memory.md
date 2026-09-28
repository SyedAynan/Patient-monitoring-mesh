# Project Memory

**Last updated:** 2026-09-28
**Current phase:** Phase 1 — Project foundation and feasibility spike

## Completed

- Existing git-backed documentation baseline was preserved after the workspace changed during setup.
- Foundation docs are present: PRD, Architecture, Rules, Phases, Design.
- Decisions selected: six target nodes; ESP-NOW-style local transport spike; Python/FastAPI backend; SQLite first; React + TypeScript later; lab-only dashboard mode initially; ECG deferred; dashboard alerts first.

## Current implementation

- Versioned `TelemetryPacketV1` contract in `shared/protocol/`.
- Standard-library validator, deterministic JSON encoder/decoder, packet builder.
- Demo script and 14 unit tests; all pass.
- `.gitignore` and `.env.example` added without secrets.

## Important decisions

- No third-party dependencies in Phase 1.
- Packet retries reuse `(device_id, sequence_number)`.
- Critical and routine traffic are explicit priorities.
- Prototype uses synthetic/non-clinical data only.

## Known issues / TBD

- Physical ESP32/PlatformIO toolchain is not installed in this workspace.
- Final radio/mesh implementation needs hardware feasibility testing.
- Packet authentication/encryption is deferred to the security phase.
- Existing untracked `assets/hardware.png` was not modified.

## Next task

Acquire/confirm two ESP32 boards and begin the two-node transport spike; keep the simulator as the fallback until PlatformIO is available.

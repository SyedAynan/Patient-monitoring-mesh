# Project Memory

**Last updated:** 2026-09-28
**Current phase:** Phase 1 — Project foundation and feasibility spike

## Completed

- Workspace confirmed empty before foundation work.
- Foundation docs created: PRD, Architecture, Rules, Phases, Design.
- Decisions selected: six target nodes; ESP-NOW-style local transport spike; Python backend direction; SQLite first; React + TypeScript later; lab-only dashboard mode initially; ECG deferred; dashboard alerts first.

## Current implementation

- Versioned `TelemetryPacketV1` contract in `shared/protocol/`.
- Standard-library validator, deterministic JSON encoder/decoder.
- Demo script and unit tests.

## Important decisions

- No third-party dependencies in Phase 1.
- Packet retries reuse `(device_id, sequence_number)`.
- Critical and routine traffic are explicit priorities.
- Prototype uses synthetic/non-clinical data only.

## Known issues / TBD

- Physical ESP32/PlatformIO toolchain is not installed in this workspace.
- Final radio/mesh protocol needs hardware feasibility testing.
- Packet authentication/encryption is deferred to the security phase.

## Next task

Run the packet contract tests, then decide whether to install PlatformIO and begin the two-node transport spike.

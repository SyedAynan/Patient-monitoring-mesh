# Delivery Phases — Resilient Edge-Intelligence Patient Monitoring Mesh

**Status:** Planning only
**Date:** 2026-09-28

## Phase tracking

- **Completed phases:** Phase 1 — project foundation (packet schema, validator,
  conformance fixtures, feasibility spike). Phase 2 — simulated sensing pipeline
  (sources, filtering, node/relay/gateway roles, abstract transport). Phase 3 —
  local transport and prioritized delivery (ack frame, priority queue, bounded
  retries, gateway acks). Phase 4 — resilient routing and store-and-forward
  (alternate relay, failure-triggered reroute, relay buffering with backfill,
  failure-scenario harness).
- **CURRENT PHASE:** Phase 5 — Backend persistence and real-time dashboard (in progress)
- **NEXT PHASE:** Phase 6 — Edge intelligence
- **DEFERRED:** physical ESP32/ESP-NOW validation, until hardware is available.
  Deferred by explicit decision on 2026-09-29. No radio result may be claimed
  before it runs on real boards.

Each phase must be completed, tested, and documented before the next begins. Do not implement the next phase automatically.

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 1 — Foundation | Complete | Contract, fixtures, validator, feasibility spike. Physical gate deferred. |
| 2 — Sensing & simulator | Complete | Simulated pipeline over an abstract transport. |
| 3 — Local transport | Complete | Priority queue, acks, bounded retries. |
| 4 — Resilient routing | Complete | Reroute, store-and-forward, backfill. 120 tests pass. |
| 5 — Backend & dashboard | **In progress** | FastAPI backend + Next.js dashboard connected to simulator. |
| 6 — Edge intelligence | Not started | |
| 7 — Security | Not started | |
| 8 — Evaluation & demo | Not started | |

**Terminology guard:** the packet contract defines a `priority` field, but no
priority *policy* exists until Phase 3. One relay hop with no alternate path is
not a mesh, and must not be described as one until Phase 4 measures reroute
behavior (Rules section 9).

---

## Phase 1 — Project foundation and feasibility spike

### Objective
Confirm the technology direction, create the repository foundation, define contracts, and prove the selected hardware/protocol can produce a reliable sample packet.

### Features included
- Repository structure and local development setup.
- Finalize provisional technology choices.
- Define the versioned telemetry packet schema.
- Select initial sensor and node hardware.
- Minimal hardware spike or simulator proving packet encode/decode.
- Define evaluation metrics and experiment method.

### Files/components involved
- `docs/*.md`
- `README.md`
- `.env.example`
- `firmware/node/` skeleton
- `simulator/` skeleton
- `backend/` skeleton only if needed for contract testing

### Database changes
None, unless a minimal local schema is needed to validate the packet contract.

### API changes
Optional `GET /health` contract only.

### UI changes
None, except an optional placeholder/screenshot plan.

### Testing requirements
- Packet schema valid/invalid fixture tests.
- Encode/decode round-trip test.
- Device identity and sequence-number rules documented.
- Hardware smoke test or simulator equivalent.

### Definition of Done
- Stack decisions documented with reasons.
- Hardware/protocol risks and fallbacks documented.
- Packet contract has fixtures and passing tests.
- One node or simulator emits a packet that decodes reliably.
- No production or clinical claims made.

---

## Phase 2 — Single-node sensing and simulator contract

### Objective
Read selected sensors, apply signal-quality checks, and produce stable telemetry from one node plus an equivalent simulator.

### Features included
- Sensor drivers.
- Sampling and filtering.
- Signal-quality metadata.
- Local timestamp/sequence handling.
- Synthetic data generator for normal and abnormal scenarios.

### Files/components involved
- `firmware/node/`
- `simulator/`
- Shared packet/schema definitions.

### Database changes
None, or a local raw capture format **[TBD]**.

### API changes
None.

### UI changes
None.

### Testing requirements
- Sensor conversion tests with fixtures.
- Range and invalid-reading tests.
- Simulator determinism tests.
- Memory/buffer bound checks where feasible.

### Definition of Done
- One physical node and the simulator produce equivalent valid packets.
- Invalid/stale readings are marked safely.
- Tests pass; hardware limitations documented.

### Status: complete (simulator side) — 2026-09-30
- Five simulated patient profiles (stable, elevated, poor contact, deteriorating,
  intermittent sensor fault, and a dead sensor) plus a relay and a gateway.
- Filtering, plausibility checks, and dispersion-based signal quality with a
  minimum-quality gate; implausible or unusable data is never published.
- Packet building goes through the existing `shared/protocol` builder and
  validator — no second packet format was introduced.
- Deterministic faults: loss, duplication, corruption, reordering, and link
  outage/reconnect, all seeded and reproducible.
- Transport abstracted behind a `Transport` protocol; roles never touch
  `SimulatedMedium`. `espnow.py` marks the replacement seam.
- 50 new tests; 79 total, no regression.
- **Not met:** the physical-node half of the Definition of Done. Hardware is not
  available, so it is deferred, not waived. The simulator is not a substitute.

---

## Phase 3 — Local transport and prioritized delivery

### Objective
Deliver telemetry from one or more nodes to a gateway with priority classes, acknowledgements, retries, and metrics.

### Features included
- Node discovery/provisioning.
- Routine vs critical packet priority.
- Acknowledgements and bounded retries.
- Gateway receiver.
- Packet delivery and latency counters.

### Files/components involved
- `firmware/node/`
- `firmware/gateway/`
- `backend/app/ingestion/` or equivalent.
- Network test fixtures.

### Database changes
Device and network-event tables or equivalent local storage.

### API changes
Health, device, and network metrics endpoints.

### UI changes
Minimal connectivity and packet metrics view.

### Testing requirements
- Drop, duplicate, retry, malformed, out-of-order packet tests.
- Priority behavior under congestion.
- Multi-node smoke test.

### Definition of Done
- Multiple nodes deliver packets to the gateway.
- Critical traffic is measurably prioritized.
- Metrics stored and visible.

### Status: complete (simulator side) — 2026-10-01
- Ack frame added to the envelope: `kind=data|ack`, `acks` names the confirmed
  message; the relay carries acks back down as well as data up.
- Bounded critical-first `PriorityQueue`: routine frames never drain before a
  waiting critical frame, capacity is enforced, and a critical admission can
  evict the oldest routine frame (counted, never silent).
- Bounded `RetryPolicy`: a message is retried at most `max_attempts-1` times,
  reusing its message identity; exhaustion is counted and the message is dropped,
  never retried forever.
- The gateway acks on acceptance *and on duplicate*, so a sender whose first ack
  was lost still terminates its retry loop.
- Sequence semantics finalized: a sequence number is consumed when a message is
  queued; retries and retransmissions reuse it (which is what licenses gateway
  dedup on `(device_id, sequence_number)`).
- 26 new tests in `tests/test_priority_delivery.py`; 105 total, no regressions.
  Retries verified to raise delivery under 40% loss: 19% → 50% → 73% accepted as
  the budget grows from 1 to 6.
- **"Metrics stored and visible"** is satisfied only in-process (stats objects
  and the demo). Persistent storage belongs to Phase 5.

---

## Phase 4 — Resilient routing and store-and-forward

### Objective
Make the local network resilient to relay/gateway interruption and recover buffered data correctly.

### Features included
- Neighbor/path health.
- Relay or multi-hop routing.
- Route change detection.
- Local buffering.
- Reconnection synchronization and deduplication.

### Files/components involved
- Firmware routing modules.
- Gateway buffering/sync modules.
- Network experiment harness.

### Database changes
Measurement sequence constraints; route/recovery/network-event records.

### API changes
Topology, recovery, and experiment metrics endpoints.

### UI changes
Network topology/status view; recovery and packet-gap visualization.

### Testing requirements
- Relay failure.
- Gateway interruption.
- Duplicate/out-of-order backfill.
- Buffer overflow and bounded recovery.

### Definition of Done
- A planned failure scenario demonstrates continued local operation.
- Buffered data returns without duplicates.
- Reroute time and recovery completeness are measured.

### Status: complete (simulator side) — 2026-10-02
- Nodes carry an optional `alternate_hop`; after `reroute_after_failures`
  consecutive transmit failures they switch, recording the route change and its
  timestamp (the M-05 event).
- The relay gained a bounded store-and-forward buffer (`buffer_capacity`, default
  0 = Phase 3 drop-and-count). Uplink loss buffers upstream frames; recovery
  backfills FIFO. Retransmissions are deduped in the buffer so a retrying sender
  cannot crowd it; the gateway's `(device_id, sequence_number)` key keeps backfill
  from creating duplicate records.
- The envelope carries `last_hop` — the radio-level fact of which peer delivered
  the frame — so acks return along the path actually used, not a guess. This is
  what makes rerouted delivery self-sustaining.
- Topology can build a two-relay mesh (`two_relay=True`); every node gets the
  second relay as its alternate hop.
- `tools/resilience_demo.py` runs S-02 (relay power-off; reroute at 2 s, delivery
  continues via relay-02) and S-03 (gateway interruption; 15/15 buffered frames
  backfilled, 100% recovery completeness, zero duplicate records). These are
  scenario demonstrations on a simulated link, not evaluation metrics: the
  recorded runs that turn them into M-05/M-06 figures are Phase 8 work.
- 15 tests in `tests/test_resilience.py`; 120 total, no regressions. The suite
  also asserts the honest limits: a single-path mesh does *not* survive relay
  loss, and buffering disabled keeps drop-and-count behaviour.

---

## Phase 5 — Backend persistence and real-time dashboard

### Objective
Persist telemetry and present a usable multi-patient monitoring dashboard.

### Features included
- Database migrations and repositories.
- Measurement history.
- Alert persistence.
- Realtime event stream.
- Patient/device dashboard.

### Files/components involved
- `backend/`
- `frontend/`
- `infra/migrations/`

### Database changes
Devices, assignments, measurements, alerts, sessions, network events.

### API changes
Versioned device, patient, measurement, alert, metrics APIs.

### UI changes
Dashboard shell, patient cards, trends, alerts, loading/error/stale states.

### Testing requirements
- API contract tests.
- Persistence and migration tests.
- Realtime reconnect tests.
- Responsive/accessibility checks.

### Definition of Done
- Four or more patient streams readable live.
- History, alerts, and stale status work.
- Dashboard remains usable during reconnects.

### Status: complete (simulator side) — 2026-10-03
- FastAPI backend (`backend/app/`) with the v1 envelope contract on every route:
  devices, patient measurement history, alerts (+acknowledge), network metrics,
  and a WebSocket realtime stream.
- The backend drives the Phase 2–4 simulator mesh as its data source; the tick
  loop harvests measurements, alert thresholds (configurable, non-clinical), and
  network events (route_change, disconnect/buffer, backfill), and broadcasts them.
- SQLite persistence (`backend/app/persistence.py`): numbered migrations, the
  `UNIQUE (device_id, sequence_number)` constraint enforcing FR-05 at the
  database, INSERT OR IGNORE on replayed packets, and history served from the
  database rather than the in-memory window. Location: `APP_DATA_DIR` (default
  `.data/app.db`); `REMPM_DISABLE_DB=1` disables it for tests.
- React + TypeScript dashboard generated from the v0 prompt
  (`frontend/v0-prompt.md`), integrated against the real backend; strict TS
  typecheck passes. `frontend_backup/` is the pre-integration copy and is
  not part of the product.
- 13 API contract tests + 15 persistence tests; full suite 133+ tests, no
  regressions. Tests keep off `.data/` via `REMPM_DISABLE_DB`.
- Known limits: alert latency (M-03/M-09) is not yet computed; auth is
  lab-only and deferred to Phase 7; MQTT is not used — the simulator feeds
  ingestion in-process (R-09's documented simplification).

---

## Phase 6 — Local risk scoring and edge intelligence

### Objective
Add transparent, testable local risk/trend logic and optional ECG intelligence without overstating medical capability.

### Features included
- Configurable trend/risk scoring.
- Signal-quality gating.
- Local critical status.
- Optional ECG classifier spike with labeled/test data.

### Files/components involved
- Firmware scoring module.
- Backend configuration and explanation endpoints.
- Dashboard risk/quality components.
- Model/evaluation fixtures if ECG is approved.

### Database changes
Risk snapshots, model/version metadata, alert evidence.

### API changes
Risk explanation and configuration endpoints.

### UI changes
Risk badge, evidence panel, prototype/model disclaimer.

### Testing requirements
- Boundary and trend tests.
- Regression fixtures.
- False-positive/false-negative evaluation for any model.
- Offline behavior tests.

### Definition of Done
- Every risk state is explainable from recorded inputs.
- Local behavior works without the backend.
- Any ML result is labeled experimental and measured.

---

## Phase 7 — Security, authentication, and authorization

### Objective
Harden the lab deployment and make identities and permissions explicit.

### Features included
- Device credential validation.
- Replay/duplicate protection.
- Dashboard authentication decision.
- Roles and audit events if approved.
- Secure configuration.

### Files/components involved
- `backend/security/`
- Gateway credential handling.
- Frontend auth/session handling.
- `.env.example` and deployment docs.

### Database changes
Users, roles, device credentials/status, audit events as needed.

### API changes
Auth/session endpoints and authorization checks.

### UI changes
Login and role-aware navigation if approved.

### Testing requirements
- Unauthorized access.
- Invalid/replayed packets.
- Credential rotation/revocation.
- Secret leakage checks.

### Definition of Done
- Security baseline tested and documented.
- No secrets committed or logged.
- Prototype limitations remain clear.

---

## Phase 8 — Evaluation, demo mode, and final documentation

### Objective
Produce repeatable evidence that the project works and communicate limitations honestly.

### Features included
- Experiment runner.
- Failure injection controls.
- Metric export.
- Session report generation.
- Final diagrams and user/developer documentation.

### Files/components involved
- `simulator/`
- `backend/experiments/`
- `frontend/experiment-console/`
- `docs/`

### Database changes
Experiment configuration and result summaries.

### API changes
Experiment start/status/results endpoints.

### UI changes
Experiment console and summary views.

### Testing requirements
- Repeatability across multiple runs.
- Packet delivery ratio, latency, reroute time, recovery completeness, throughput.
- Full build/test/lint/type-check pass.

### Definition of Done
- Live demo script is repeatable.
- Evaluation tables/graphs based on measured results.
- Known issues and future work documented.
- Final report does not claim clinical validation.
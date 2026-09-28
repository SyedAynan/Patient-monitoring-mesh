# Delivery Phases — Resilient Edge-Intelligence Patient Monitoring Mesh

**Status:** Planning only
**Date:** 2026-09-28

## Phase tracking

- **Completed phases:** None
- **CURRENT PHASE:** Phase 1 — Project foundation and feasibility spike
- **NEXT PHASE:** Phase 2 — Single-node sensing and simulator contract

Each phase must be completed, tested, and documented before the next begins. Do not implement the next phase automatically.

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
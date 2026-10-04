# Architecture — Resilient Edge-Intelligence Patient Monitoring Mesh

**Status:** Initial planning
**Date:** 2026-09-28

## 1. Architectural goals

- Make computer networking a first-class project feature.
- Keep patient-node operation useful during gateway or route failure.
- Separate embedded, transport, ingestion, storage, and presentation concerns.
- Keep the first implementation simple enough for a student team to test and explain.
- Allow future protocol and model experiments without rewriting the dashboard.

## 2. Overall system architecture

```text
[Sensor Node(s)]
  sensors -> filtering -> local status/risk -> packet queue
      |  prioritized local network / relay / retry
      v
[Edge Gateway]
  discovery + validation + deduplication + buffering + MQTT bridge
      v
[Backend Services]
  ingestion -> validation -> persistence -> realtime stream -> metrics
      v
[Web Dashboard]
  patient status + trends + alerts + topology + experiment metrics
```

A node may raise a local alarm even when the gateway is unavailable. The gateway is an edge service, not the sole source of safety behavior.

## 3. Technology direction

Phase 1 decisions are Python/FastAPI backend, React + TypeScript dashboard, SQLite-first storage, six target nodes, and an ESP-NOW-style local transport spike with an application-level relay layer. The hardware spike must still confirm the final radio implementation.

### Embedded nodes
- **Candidate:** ESP32 with PlatformIO (Arduino-compatible C++).
- **Why:** affordable, locally available, Wi-Fi support, sufficient CPU/GPIO, mature sensor libraries, easy procurement for a student team.
- **Alternative:** ESP-IDF if networking requirements exceed the initial framework.

### Local networking
- **Candidate:** ESP-NOW with an application-level relay/routing layer, or a supported Wi-Fi/802.15.4 mesh.
- **Why:** low-cost local communication and an observable networking research surface.
- **Decision rule:** choose the protocol that can be reliably demonstrated, measured, and secured with available hardware. Do not claim standards-level mesh behavior until node-failure and reroute behavior is measured.

### Gateway/backend
- **Candidate:** Python FastAPI.
- **Why:** typed API contracts, fast iteration, straightforward testing, WebSocket support, strong data/scientific tooling.
- **Alternative:** Node.js/TypeScript if the team has stronger TypeScript expertise.

### Messaging
- **Candidate:** MQTT between gateway and backend, with a local broker (e.g., Mosquitto).
- **Why:** lightweight pub/sub, topic-based separation, retained status, QoS options, clear IoT semantics.
- **HTTP:** administration, history, experiments, health endpoints.

### Database
- **Phase 1 choice:** SQLite with a time-series-friendly schema.
- **Why:** zero-service local setup and fast contract/integration testing.
- **Migration path:** PostgreSQL for the production-like demo; InfluxDB remains an alternative only if measurement analytics later justify the added service.

### Frontend
- **Candidate:** React + TypeScript with a minimal component system and WebSocket/SSE updates.
- **Why:** reusable dashboard components, strong ecosystem, clean separation from backend APIs.

### Testing
- Unit tests for packet parsing, scoring, deduplication, routing policy, API validation.
- Integration tests for gateway-to-backend ingestion.
- Hardware-in-the-loop tests where hardware exists; simulator fixtures must cover everything else.

## 3a. Implemented structure (Phase 2)

Phase 2 built the simulator side of the embedded and transport layers. The
layering exists so a real radio replaces the simulated one without touching the
protocol or application code:

```text
shared/protocol/          contract, validator, error codes, conformance fixtures
simulator/
  transport/
    base.py               Transport protocol + LinkUnavailable
    envelope.py           Frame: routing header + opaque payload
    simulated.py          SimulatedMedium + SimulatedTransport (fault injection)
    espnow.py             EspNowTransport -- NOT IMPLEMENTED, deferred
  sensing/
    sources.py            VitalSource implementations (nominal/trending/noisy/faulty)
    processing.py         plausibility bounds, SignalFilter, quality estimate
  roles/
    node.py               SensorNode: sample -> filter -> build -> transmit
    relay.py              RelayNode: forward frames, never parse payloads
    gateway.py            Gateway: validate, deduplicate, account
  topology.py             builds node -> relay -> gateway
```

**Dependency rule:** `roles/` may import `transport.base` and `transport.envelope`;
it must never import `transport.simulated` or a concrete medium. A test in
`tests/test_simulated_pipeline.py` asserts this, so the seam cannot erode silently.

**Frame versus payload.** The `Frame` envelope carries routing only (`source`,
`destination`, `message_id`, `hop_count`) and treats the payload as opaque bytes.
For telemetry the payload is exactly the `TelemetryPacketV1` bytes. A relay
therefore forwards vitals it never interprets, and the protocol layer is unaware
of which radio carried it.

**What Phase 2 deliberately does not do:** priority queues and acknowledgement
(Phase 3), store-and-forward and alternate paths (Phase 4), persistence and
dashboard (Phase 5), risk scoring (Phase 6), authentication (Phase 7).

## 3b. Implemented structure (Phase 5)

Phase 5 added the backend and dashboard:

```text
backend/app/
  main.py               FastAPI factory, CORS, lifespan (starts the simulator)
  simulator_state.py    runs the mesh in-process; harvests and broadcasts
  persistence.py        SQLite: numbered migrations, FR-05 uniqueness constraint
  routes/               devices, patients (history from DB), alerts, network,
                        realtime (WebSocket)
frontend/               React 19 + TS (strict) + Tailwind + shadcn/ui + Recharts
  lib/api.ts            typed client, envelope handling, real-backend base URL
  lib/realtime.ts       WebSocket client with exponential-backoff reconnect
  components/           monitoring dashboard, patient cards, trends, alerts,
                        network view, 3D digital-twin view, ECG canvas
```

**The backend is the authority.** It validates nothing from the frontend beyond
query parameters, but every measurement it serves passed `shared/protocol`
validation on ingestion, and the database enforces the
`(device_id, sequence_number)` uniqueness. The frontend renders backend values;
its demo-mode risk score is a client heuristic, not the authoritative risk state
(Phase 6 owns that, server-side).

**Simulator as data source (documented simplification, R-09):** instead of an
MQTT broker between gateway and backend, the backend ticks the mesh in-process.
The domain separation is preserved — swap in a real gateway feed later without
touching routes, persistence, or the dashboard.

## 3c. Implemented structure (Phase 7)

Security, exactly where section 8 said it would live:

```text
shared/security/        MAC (HMAC-SHA256 over immutable frame fields) +
                        DeviceCredentialStore (provision/revoke/rotate)
simulator/transport/    Frame.auth field (optional, 64-hex, preserved by relays)
simulator/roles/        node signs when keyed; gateway verifies BEFORE parsing
backend/app/security.py operator-token guard (lab|token modes) + audit events
backend/app/routes/     POST /devices/{id}/revoke (guarded); acknowledge (guarded)
```

The gateway is the single enforcement point: authentication precedes contract
validation, rejected frames get no acknowledgement, and every rejection reason
is counted. The backend API adds an operator layer above it — lab mode (no
login, the PRD's documented MVP decision) or token mode for mutations, failing
closed when misconfigured. Audit events record every security-relevant decision
without ever recording a secret.

## 4. Frontend architecture

- `AppShell`: navigation, environment/status banner, responsive layout.
- `PatientOverview`: patient cards and latest status.
- `PatientDetail`: charts, alerts, signal quality, device information.
- `NetworkMonitor`: topology, node health, route changes, packet metrics.
- `ExperimentConsole`: controlled failure and replay actions.
- `Shared UI`: status badge, card, table, chart container, empty/loading/error states.
- `api/`: typed API client.
- `realtime/`: WebSocket/SSE connection and reconnect policy.
- `state/`: server state plus small UI state only; avoid global state unless shared behavior requires it.

The frontend must not calculate authoritative medical or network metrics. It renders backend-provided values and clearly labels prototype/demo status.

## 5. Backend architecture

Suggested modules:

- `api`: route handlers and request/response schemas.
- `domain`: measurement, alert, device, experiment logic.
- `ingestion`: MQTT subscription, packet decoding, validation, deduplication.
- `network`: packet/route metrics and topology events.
- `persistence`: repositories and migrations.
- `realtime`: event fan-out to dashboard clients.
- `security`: device credentials, token/session handling, authorization.
- `simulator`: synthetic nodes and failure scenarios.

Keep domain logic independent of transport so MQTT, test fixtures, and future transports can reuse it.

## 6. Database architecture

Relational metadata and measurements stay logically separate even if initially stored in one database.

Minimum tables:

- `devices`
- `patient_assignments`
- `measurements`
- `alerts`
- `network_events`
- `experiment_sessions`
- `users` (Phase 7 only, if authentication is enabled)

Use UTC timestamps, immutable measurement records, a unique constraint on `(device_id, sequence_number)`, indexes on device/time, and migrations for every schema change.

## 7. API architecture

All API responses use:

```json
{ "data": {}, "error": null }
```

or

```json
{ "data": null, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
```

Candidate endpoints:

- `GET /health`
- `GET /api/v1/devices`
- `POST /api/v1/devices`
- `GET /api/v1/patients/:id/measurements`
- `GET /api/v1/alerts`
- `POST /api/v1/alerts/:id/acknowledge`
- `GET /api/v1/network/metrics`
- `GET /api/v1/experiments/:id`
- `POST /api/v1/simulator/events`
- `WS /api/v1/realtime`

Exact routes are **[TBD]** until the domain model is finalized.

## 8. Authentication and authorization

### Device flow
1. Provision a unique device identity and credential.
2. Node authenticates to the local network/gateway.
3. Gateway rejects unknown, revoked, malformed, or replayed packets.
4. Rotation/revocation strategy documented before any real deployment claim.

### Dashboard flow
- Local demo may begin with a protected operator session or lab-only mode.
- If accounts are enabled: short-lived access tokens or secure server sessions, hashed passwords, role checks on the backend.
- Authorization is enforced server-side, never only in the UI.

## 9. State management

- Backend is authoritative for persisted telemetry, alerts, and experiment state.
- Frontend keeps transient filters, selected patient, connection state, optimistic UI state only.
- Nodes keep local ring buffers, sequence counters, configuration, current risk state.

## 10. File and storage strategy

- No real patient files in MVP.
- Experiment exports stored outside source control in a configurable data directory.
- Secrets provided via environment, never committed.
- Firmware and backend logs use rotation in local deployments.

## 11. Error handling and validation

- Validate at every boundary: sensor packet, gateway message, API request, database write, frontend response.
- Reject malformed packets early and record a safe diagnostic event.
- Use stable machine-readable error codes.
- Never expose secrets, stack traces, or raw credentials to clients.
- Use timeouts, bounded retries, exponential backoff, and idempotency keys/sequence numbers.

## 12. Security considerations

- Encrypt backend transport with TLS wherever deployed beyond a trusted lab.
- Authenticate device messages; protect against replay with sequence numbers/nonces.
- Least privilege for broker, database, and service credentials.
- Keep test data synthetic and de-identified.
- Threat-model spoofed nodes, tampered packets, replay, gateway compromise, unauthorized dashboard access, data leakage.
- Treat prototype risk scores as non-clinical indicators.

## 13. Environment variables

Names are provisional:

- `APP_ENV`
- `API_HOST`
- `API_PORT`
- `DATABASE_URL`
- `MQTT_BROKER_URL`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `DEVICE_CREDENTIAL_SECRET`
- `SESSION_SECRET` or `JWT_SECRET`
- `CORS_ORIGINS`
- `LOG_LEVEL`
- `DATA_DIR`

Provide `.env.example`; never commit `.env` or real credentials.

## 14. Third-party integrations

- MQTT broker: **[TBD]** local Mosquitto or embedded broker.
- External alert provider: **[TBD]**, future only.
- Charts: use the selected frontend chart library only after checking whether the current stack already covers it.
- Clinical standards/datasets: only documented, permitted sources, labeled educational use.

## 15. Deployment architecture

### Development
- Laptop runs backend, database, broker, and frontend locally.
- Nodes connect to a dedicated lab Wi-Fi or selected local radio network.
- Simulator can replace physical nodes.

### Production-like demo
- Raspberry Pi or mini-PC runs gateway, broker, backend, database.
- Dashboard served locally over the LAN.
- Optional second machine for the dashboard display.
- No public exposure by default.

Containerization is **[TBD]**; avoid it until it improves reproducibility without hiding the networking behavior being evaluated.

## 16. Proposed folder structure

```text
/docs
  PRD.md
  Architecture.md
  Rules.md
  Phases.md
  Design.md
  Memory.md              # created when implementation begins
/firmware
  /node
  /gateway
/backend
  /app
  /tests
/frontend
  /src
/simulator
  /src
/infra
  .env.example
  migrations/
README.md
```

Exact package layout is **[TBD]** after Phase 1 technology selection.

## 17. Data flow

1. Sensor samples are read and quality-checked.
2. Node filters values and calculates local status.
3. Node assigns routine or critical priority and increments the sequence number.
4. Network forwards the packet using retry/relay policy.
5. Gateway authenticates, validates, deduplicates, timestamps receipt, publishes/queues.
6. Backend persists the record and emits a realtime event.
7. Frontend updates patient, alert, and network views.
8. Metrics pipeline records delivery, latency, retries, recovery events.

## 18. Important decisions

- Local-first behavior is mandatory; it is the core differentiator.
- The network protocol is an experiment decision, not a pre-approved fact.
- Medical algorithms are advisory prototype logic, not diagnosis.
- Every hardware-dependent path needs a simulator/test fixture.
- Observability and measured evaluation are part of the product, not afterthoughts.
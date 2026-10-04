# Final Report — Resilient Edge-Intelligence Patient Monitoring Mesh

**Project type:** Academic major project — MedTech + IoT + Computer Networking
**Status:** Phases 1–8 complete (software). Physical ESP32/ESP-NOW validation deferred.
**Evidence root:** `.data/experiments/` (campaign `2026-10-04`, 40 recorded sessions)

---

## 1. What was built

A complete simulated prototype of a multi-patient monitoring mesh, built and
evaluated in eight phases, 249 passing tests, with a recorded-evidence
evaluation campaign:

| Layer | What exists | Where |
| --- | --- | --- |
| Wire contract | `TelemetryPacketV1`: schema, authoritative validator, stable error codes, 32-fixture conformance corpus | `shared/protocol/` |
| Sensing | Synthetic vital sources (stable, elevated, poor-contact, deteriorating, faulty), bounded filtering, dispersion-based signal quality, quality gate | `simulator/sensing/` |
| Transport | `Transport` abstraction, `Frame` envelope (data/ack, auth MAC, last-hop), seeded fault injection (loss/corruption/duplication/reorder/outage) | `simulator/transport/` |
| Delivery | Bounded critical-first priority queue, acks returned via the actual path, bounded retries with escalation on critical risk | `simulator/roles/` |
| Resilience | Alternate relay with failure-triggered reroute, bounded relay store-and-forward with in-buffer dedup and backfill | `simulator/roles/`, `topology.py` |
| Risk | One rule-based engine shared by nodes and backend: thresholds + trends, quality gate, full evidence, config fingerprint; node-local escalation | `shared/risk/` |
| Security | HMAC-SHA256 frame MAC verified before payload parsing, provisioned credentials with revocation, operator-token guard, audit trail | `shared/security/`, `backend/app/security.py` |
| Backend | FastAPI, envelope contract, SQLite with 6 migrations and the `(device_id, sequence_number)` uniqueness constraint, WebSocket realtime | `backend/app/` |
| Dashboard | React + strict TypeScript: patient cards, trends with real gaps, alerts, network view, 3D digital-twin, renders backend risk only | `frontend/` |
| Evaluation | Scenario runner (S-01…S-08), evidence directories, M-01…M-12 computed from recorded records only, aggregation across 5 runs/scenario | `tools/run_experiments.py`, `tools/experiment_metrics.py` |

## 2. Evaluation results

Full tables with per-run median/min/max: `.data/experiments/campaign-2026-10-04.md`.
Headline results (5 runs each, simulated single-clock — see section 4):

| Scenario | Finding |
| --- | --- |
| S-01 baseline | 100% delivery, 0% protocol errors, 100% traceability, 1000 ms median single-hop latency |
| S-02 relay power-off | every node rerouted to the alternate relay (median 6 s, consistent across runs) with **100% delivery** — NFR-03 demonstrated |
| S-03 gateway interruption | relay buffered up to 19 frames, backfilled with **100% recovery completeness** and **zero duplicate records** (1% duplicate deliveries suppressed) — FR-06 demonstrated |
| S-04 congestion | delivery degrades measurably under 10% loss at 5× rate (65.5%); queue/retry behaviour visible in latency; see honest note below |
| S-06 buffer overflow | the 4-frame bound evicts and **counts** (53.2% delivery) — bounded behaviour, never silent, never unbounded |
| S-07 faults + recovery | under combined loss/duplication/reordering, 48.7% delivery but 97.3% of outage packets recovered, duplicates delivered yet never stored twice |
| S-08 soak | 5×~5 min: 99.7–100% delivery, queue bounds held, no drift |

**Honest finding (recorded, not hidden):** under S-04 congestion, median
critical-packet latency (38 s) was *worse* than routine (19 s). The priority
policy drains critical packets first, but the critical nodes in that scenario
also carried the retry load after losses; the recorded evidence shows priority
alone does not guarantee lower critical latency under congestion. This is a
real, reproducible result of the current policy — worth revisiting when the
radio layer exists.

## 3. Requirements traceability

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| FR-02 packet metadata | Met | `shared/protocol/` contract + fixtures |
| FR-03 stale detection | Met (simulator/backend clock) | 12 s threshold, tested; M-08 display path tested |
| FR-04 critical priority | Partially met — see S-04 finding | queue order tested; latency under congestion did not favour critical |
| FR-05 no duplicates | Met | S-03/S-07 M-06 + M-01 unique-key computation; DB constraint |
| FR-06 buffering ≥ outage | Met | S-03: 100% recovery, bounded buffer |
| FR-08 network metrics | Met | M-01…M-12 from recorded evidence |
| FR-09 safe demo mode | Met | synthetic data only, everywhere |
| FR-10 alert acknowledgement | Met | tested, audited |
| FR-11 no diagnosis claims | Met | disclaimers in README, dashboard, this report |
| NFR-03 one relay down | Met | S-02 |
| NFR-04 traceability | Met | M-12 = 100% in every scenario |
| NFR-06 testable without hardware | Met | 249 tests, no hardware required |
| FR-01 ≥ 6 nodes | **Not met** | simulator supports 5 patient profiles; recorded as a limitation in S-04 notes |
| Physical transport | **Deferred** | explicit decision, 2026-09-29 |

## 4. Limitations (read before citing any number)

1. **Everything is simulated.** The mesh runs on one process and one clock.
   Latency figures (M-02/M-03/M-05/M-07) measure queue, retry, and backfill
   behaviour — they say nothing about radio propagation, interference, or
   ESP-NOW's 250-byte frame limit (risk R-21, unresolved).
2. **Physical ESP32/ESP-NOW validation is deferred until hardware is
   available.** No board has been flashed. `EspNowTransport` raises
   `NotImplementedError` by design.
3. **M-08/M-09 are marked not measured.** Stale-display time and dashboard
   freshness need a live browser session; the evidence-only rule refuses to
   estimate them.
4. **Priority under congestion** did not reduce critical latency (S-04) —
   recorded above, unexplained away.
5. **Five nodes, not six** (FR-01) — simulator profile limit, recorded in
   evidence notes.
6. **Security is a lab baseline.** Seed-derived demo master key, unsigned acks
   (no telemetry payload), no TLS deployment story, no per-device key
   distribution tooling.
7. **Not a medical device.** No clinical validation, no diagnosis, thresholds
   are round demo numbers. This sentence appears in the README, the dashboard
   banner, the demo script, and here.

## 5. Future work

- The physical transport spike (R-01/R-21): two ESP32s, one relay hop, the
  conformance fixtures on real hardware — the single highest-value next step.
- Priority policy revision informed by the S-04 finding.
- MQTT broker between a real gateway and the backend (the in-process feed was
  the documented simplification, R-09).
- Per-device key provisioning/rotation tooling; TLS for backend transport.
- ECG/arrhythmia work only after hardware and labeled data exist, labeled
  experimental, with measured false-positive/false-negative rates.
- PostgreSQL migration path when the SQLite lab limits are reached.

## 6. How to reproduce everything

```bash
python -m unittest discover -s tests -p "test_*.py" -v   # 249 tests
python tools/run_experiments.py --runs 5                 # the campaign
python tools/resilience_demo.py                          # S-02/S-03 narratives
python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000
cd frontend && npm run dev                               # dashboard
```

Live demo walkthrough: `docs/DemoScript.md`. Design decisions: `docs/`.
Every number in section 2 resolves to a directory under
`.data/experiments/` containing its config, raw records, and summary.

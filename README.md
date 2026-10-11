<div align="center">

# Resilient Edge-Intelligence Patient Monitoring Mesh
**Academic major project — MedTech + IoT + Computer Networking**

![Patient Monitoring Mesh Hero](./assets/hero_1.jpg)

*A real-time, multi-patient monitoring prototype in which sensor nodes collect vital signs, perform local risk analysis, and reliably deliver prioritized telemetry through a resilient local mesh to an edge gateway and dashboard.*

[![Phase](https://img.shields.io/badge/Progress-Phase%208%20Complete%20(All%20Software)-blue.svg)](#-current-status)
[![Tests](https://img.shields.io/badge/Tests-249%2F249%20passing-brightgreen.svg)](#-verify-it)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](.github/LICENSE)
[![CI](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/ci.yml/badge.svg)](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/ci.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](.github/CONTRIBUTING.md)
[![Download APK](https://img.shields.io/badge/📲_Download_APK-latest-blue?style=for-the-badge&logo=android&logoColor=white)](https://github.com/SyedAynan/Patient-monitoring-mesh/releases/latest/download/carenet-mesh.apk)

</div>

> **⚠️ Disclaimer:** This is an educational/research prototype. It is not a certified medical device, makes no clinical claims, and does not replace clinical judgment. All data is **synthetic and non-clinical**. All network figures are **simulated single-clock values** — physical ESP32/ESP-NOW validation is deferred until hardware is available.

<div align="center">

**📱 One-tap install on Android:** open the
[Latest Release](https://github.com/SyedAynan/Patient-monitoring-mesh/releases/latest)
page on your phone, tap **`carenet-mesh.apk`**, allow the download, then tap
**Install** (allow "unknown sources" for your browser when asked).

</div>

## Table of Contents
- [📲 Install on Android](#-install-on-android)
- [⭐ Core Features](#-core-features)
- [🏗️ Architecture](#️-architecture)
- [📁 Repository Layout](#-repository-layout)
- [🚀 Quickstart](#-quickstart)
- [📊 Demo in 10 Minutes](#-demo-in-10-minutes)
- [🔌 API Reference](#-api-reference)
- [✅ Verify It](#-verify-it)
- [📈 Evaluation Results](#-evaluation-results)
- [🔒 Security Baseline](#-security-baseline)
- [📚 Documentation](#-documentation)
- [🚀 Current Status](#-current-status)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## 📲 Install on Android

> **One-tap install — no build tools needed.**

<div align="center">

### 👉 [**Download CareNet Mesh APK**](https://github.com/SyedAynan/Patient-monitoring-mesh/releases/latest/download/carenet-mesh.apk) 👈

[![Release APK](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/release-apk.yml/badge.svg)](https://github.com/SyedAynan/Patient-monitoring-mesh/actions/workflows/release-apk.yml)

**Scan from your phone** — opens the download:

<img src="./assets/apk-download-qr.png" width="180" alt="QR code linking to the CareNet Mesh APK download" />

</div>

**Steps:**
1. Tap the download link above on your phone (or scan the QR code).
2. Android will ask to allow installs from your browser — tap **Allow**.
3. Tap the downloaded `carenet-mesh.apk` to install.
4. Open the app → **Settings → Backend Server** → enter your PC's LAN IP (e.g. `192.168.1.10`).
5. Start the backend with LAN binding (see [Quickstart](#-quickstart)) and keep both devices on the **same Wi-Fi**.

> **How it's built:** a [GitHub Actions workflow](.github/workflows/release-apk.yml) builds the APK (JDK 21, Capacitor 8) on every version tag (`git tag v1.0.0 && git push origin v1.0.0`) or manual trigger, and maintains a rolling `latest` pre-release. Local builds: `build-apk.bat` / `./build-apk.sh` (run `setup-android-sdk` first if you lack Android Studio). Full details: [docs/MobileApp.md](docs/MobileApp.md).

You can also install the dashboard as a **PWA**: open `http://<PC-LAN-IP>:3000` on your phone → browser menu → **Add to Home Screen / Install app**.

## ⭐ Core Features

- **Multi-node sensing** — five simulated patient profiles (stable, stable-elevated, poor-contact, deteriorating, intermittent-sensor fault) with filtering, plausibility checks, and dispersion-based signal quality + quality gate (`simulator/sensing/`, `simulator/topology.py`).
- **Local risk scoring** — one shared rule-based engine (`shared/risk/`): thresholds + trends + quality gate, full per-rule evidence, config fingerprint. Nodes score locally; critical escalates packet priority.
- **Resilient local networking** — critical-first bounded priority queue, ack frames returned along the path actually used, bounded retries, alternate-relay reroute on failure, bounded relay store-and-forward with FIFO backfill (`simulator/roles/`, `simulator/transport/`).
- **Gateway ingestion** — validates (auth → contract), deduplicates on `(device_id, sequence_number)`, counts every rejection reason, acks accepted *and* duplicate frames so retry loops terminate.
- **Real-time dashboard** — React 19 + strict TypeScript + Tailwind + Recharts: patient cards, vital trends with real gaps, alerts with evidence, network view, 3D digital-twin, WebSocket stream with exponential-backoff reconnect. Renders **backend risk only** (client heuristic is fallback).
- **Store-and-forward** — relay buffers during gateway outage, backfills on recovery with in-buffer dedup; gateway + DB uniqueness keep backfill from creating duplicate records.
- **Security baseline** — HMAC-SHA256 frame MAC verified before payload parsing, provisioned credentials with revocation, operator-token guard for mutations, append-only audit trail. Lab baseline, not production hardening (see [Security](#-security-baseline)).
- **Recorded evaluation** — scenario runner S-01…S-08 with per-session evidence dirs (`config.json` / `raw.jsonl` / `summary.json` / `notes.md`); metrics M-01…M-12 computed from recorded records only, never estimated.

## 🏗️ Architecture

```text
[Sensor Node(s)]  sample → filter → quality gate → local risk → priority queue → transmit
      │  Frame envelope (routing header + opaque payload) · data/ack · optional MAC
      v
[Relay(s)]        forward frames, never parse payloads · store-and-forward buffer · reroute
      v
[Edge Gateway]    verify MAC → validate contract → deduplicate → ack → account
      v  (documented simplification R-09: backend ticks the mesh in-process instead of MQTT)
[Backend]         FastAPI · SQLite (6 migrations, UNIQUE(device_id, seq)) · WebSocket fan-out
      v
[Dashboard]       patient status + trends + alerts + topology + experiment metrics
```

**Key seams (what makes this explainable in a viva):**
- `Frame` carries routing only (`source`, `destination`, `message_id`, `hop_count`, `kind`, `acks`, `auth`, `last_hop`); telemetry payload is opaque bytes. Relays route what they never interpret.
- `roles/` import only `transport.base` + `transport.envelope` — never `transport.simulated`. A test asserts this, so `EspNowTransport` is a drop-in link replacement, not an app rewrite.
- Risk cannot drift: nodes and backend import the **same** `shared/risk` module; `PUT /risk/config` syncs running node configs.
- Backend is the authority: every served measurement passed `shared/protocol` validation on ingestion; the DB enforces FR-05 uniqueness.

## 📁 Repository Layout

| Path | What lives there |
|------|------------------|
| `shared/protocol/` | `TelemetryPacketV1` contract, validator, error codes, 32-fixture conformance corpus |
| `shared/risk/` | Rule-based risk engine shared by nodes + backend |
| `shared/security/` | HMAC frame MAC + `DeviceCredentialStore` (provision/revoke/rotate, fail-closed) |
| `simulator/transport/` | `Transport` protocol, `Frame`, `SimulatedMedium` (seeded faults), `espnow.py` (raises `NotImplementedError` by design) |
| `simulator/sensing/` | `VitalSource`s, `SignalFilter`, plausibility bounds, quality estimate |
| `simulator/roles/` | `SensorNode`, `RelayNode`, `Gateway`, `priority.py` (queue + retry policy) |
| `simulator/topology.py` | Builds `node-01…05 → relay-01 (+relay-02) → gateway-01` |
| `backend/app/` | FastAPI factory, lifespan (starts simulator), SQLite persistence, `routes/` (devices, patients, alerts, network, realtime, risk), operator-guard + audit |
| `frontend/` | Next.js 16 + React 19 + strict TS dashboard; `lib/api.ts`, `lib/realtime.ts`, Capacitor Android shell under `frontend/android/` |
| `tools/` | `packet_demo.py`, `mesh_demo.py`, `resilience_demo.py`, `run_experiments.py`, `experiment_metrics.py`, `generate_fixtures.py` |
| `tests/` | 249-test unittest suite (protocol, pipeline, priority, resilience, risk, security, API, persistence, experiments) |
| `docs/` | PRD, Architecture, Rules, Phases, Design, Memory + Evaluation, Risks, DemoScript, FinalReport, MobileApp |

## 🚀 Quickstart

**Requirements:** Python 3.10+, Node.js 18+.

```bash
# 1. Backend deps + start (http://127.0.0.1:8000)
python -m venv .venv && .venv/Scripts/activate   # or: source .venv/bin/activate
pip install -r backend/requirements.txt
python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000

# 2. Dashboard (http://localhost:3000) — second terminal
cd frontend && npm install && npm run dev
```

LAN mode for the APK (backend reachable from the phone on the same Wi-Fi):

```bash
# if one-click scripts are present:  start.bat --lan   (Windows)  /  ./start.sh --lan
# manual equivalent:
python -m uvicorn backend.app.main:create_app --factory --host 0.0.0.0 --port 8000
# then in the app: Settings → Backend Server → your PC's LAN IP (ipconfig → IPv4)
```

Health check: `GET /health` → `{ "status": "ok", … }`. Dashboard header shows **Connected**; the prototype banner stays visible on every page.

**Simulator demos (no hardware needed):**

```bash
.venv/Scripts/python.exe tools/packet_demo.py
.venv/Scripts/python.exe tools/mesh_demo.py
.venv/Scripts/python.exe tools/resilience_demo.py   # S-02 relay power-off + S-03 gateway outage
```

**Authenticated variant (Phase 7):**

```bash
MESH_AUTH=1 BACKEND_AUTH_MODE=token OPERATOR_TOKEN=$(python -c "import secrets; print(secrets.token_urlsafe(24))") \
  python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000
# mutations (acknowledge, revoke) now require:  -H "X-Operator-Token: <token>"
```

## 📊 Demo in 10 Minutes

Full script: [docs/DemoScript.md](docs/DemoScript.md). Condensed:

1. **Opening (1 min):** five patient cards, all Normal. Say out loud: simulated, non-clinical data; mesh is simulated; ESP32 validation deferred.
2. **Normal operation (2 min):** watch the deteriorating profile trend (HR up, SpO₂ down) → risk badge escalates Normal → Attention → Critical with named rule evidence. Acknowledge the alert (operator action).
3. **Resilience (4 min):** run `tools/resilience_demo.py` — S-02 relay power-off (nodes reroute, delivery continues, NFR-03) and S-03 gateway interruption (relay buffers, **15/15 backfilled, zero duplicate records**, FR-05/FR-06).
4. **Evidence discipline (1 min):** `tools/run_experiments.py --scenarios S-02 --runs 3 --date demo` → open one `.data/experiments/demo-S-02-1/` dir: `config.json` + `raw.jsonl` + `summary.json` + `notes.md`. *"No metric without an evidence directory."*
5. **Security (1 min, optional):** `/health` reports `auth_mode` (never the token); acknowledge without token → 401, with token → 200.
6. **Close:** contract → mesh → priority → store-and-forward → backend/dashboard → explainable risk → security → recorded evaluation. *"Measured or labeled simulated. Prototype, not a medical device."*

## 🔌 API Reference

All v1 responses use the envelope `{ "data": …, "error": null }` (or `error: { code, message, details }`).

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/health` | `status`, `tick_count`, `auth_mode` (never the token) |
| `GET` | `/api/v1/devices` | Known devices + status |
| `POST` | `/api/v1/devices/{id}/revoke` | Guarded (token mode); audited |
| `GET` | `/api/v1/patients/{id}/measurements` | History **from SQLite** |
| `GET` | `/api/v1/alerts` | Active + acknowledged |
| `POST` | `/api/v1/alerts/{id}/acknowledge` | Guarded (token mode); audited |
| `GET` | `/api/v1/network/metrics` | Delivery, latency, retries, recovery events |
| `GET` | `/api/v1/patients/{id}/risk` | Level, packet risk, snapshot history with evidence |
| `GET` / `PUT` | `/api/v1/risk/config` | Validated; PUT syncs running node configs |
| `WS` | `/api/v1/realtime` | Measurements, alerts, risk changes, network events; client reconnects with backoff |

DB: SQLite via numbered migrations (`APP_DATA_DIR`, default `.data/app.db`); `UNIQUE (device_id, sequence_number)` enforces FR-05 at the database; `INSERT OR IGNORE` on replay. Tests set `REMPM_DISABLE_DB=1` so they never touch `.data/`.

## ✅ Verify It

```bash
.venv/Scripts/python.exe -m unittest discover -s tests -p "test_*.py"   # 249 tests, ~12 s
python tools/run_experiments.py --runs 5                                 # full campaign → .data/experiments/
python tools/resilience_demo.py                                          # S-02 / S-03 narratives
cd frontend && npm run build                                             # Next.js strict build (last green: ea8ef26)
```

Frontend typecheck is strict TS (`tsc --noEmit` via build). CI mirrors the unittest command (pytest is **not** installed).

## 📈 Evaluation Results

Recorded campaign `2026-10-04`: 40 sessions, 5 runs/scenario. Full per-run median/min/max: `.data/experiments/campaign-2026-10-04.md` (+ [docs/FinalReport.md](docs/FinalReport.md)).

| Scenario | Finding |
|----------|---------|
| S-01 baseline | 100% delivery, 0% protocol errors, 100% traceability |
| S-02 relay power-off | reroute median **6 s**, **100% delivery** — NFR-03 demonstrated |
| S-03 gateway interruption | **100% recovery completeness, zero duplicate records** — FR-05/FR-06 demonstrated |
| S-04 congestion | delivery degrades measurably (65.5% @ 10% loss, 5× rate); **honest negative:** median critical latency (38 s) was *worse* than routine (19 s) — priority alone doesn't guarantee lower critical latency under congestion |
| S-06 buffer overflow | 4-frame bound evicts and **counts** (53.2%) — bounded, never silent |
| S-07 faults + recovery | 48.7% delivery under combined faults, 97.3% of outage packets recovered, duplicates delivered yet never stored twice |
| S-08 soak | 99.7–100% delivery, queue bounds held, no drift |

**Read before citing any number:**
1. Everything is simulated — one process, one clock. Latency figures measure queue/retry/backfill behavior, not radio propagation. ESP-NOW's 250-byte frame limit (risk R-21) is unresolved.
2. M-08/M-09 (live-browser alert latency) are explicitly **not measured**, never estimated.
3. Five patient profiles, not six (FR-01 **not met**, recorded as a limitation).
4. "Two-path failover on a simulated link" — never "self-healing mesh".

## 🔒 Security Baseline

- Frame MAC: HMAC-SHA256 over immutable envelope fields, constant-time verify; gateway verifies **before** payload parsing; rejected frames get no ack; every rejection reason counted.
- Credentials: `DeviceCredentialStore` — provision/revoke/rotate, fail-closed; secrets memory-only. Replay window is a counted signal, never suppressing backfill.
- Dashboard auth (per PRD §11): **lab mode by default, no login**. `BACKEND_AUTH_MODE=token` guards mutations via `X-Operator-Token` (constant-time compare; unconfigured = fail closed). `/health` reports mode, never the token.
- Audit: append-only `audit_events` table records every allow/refuse decision without secrets.
- Limits, stated plainly: seed-derived demo master key, unsigned acks (carry no telemetry), no TLS story, no per-device key-distribution tooling. Lab baseline, not production security.

## 📚 Documentation

| Doc | Covers |
|-----|--------|
| [PRD](docs/PRD.md) | Vision, users, MVP features, FR/NFR, out-of-scope |
| [Architecture](docs/Architecture.md) | System design + implemented Phase 2/5/7 structures |
| [Design](docs/Design.md) | Design tokens, layout, states, accessibility, prototype disclosure |
| [Phases](docs/Phases.md) | Delivery plan, per-phase DoD, Phase 9 proposal, Phase 10 deferred |
| [Evaluation](docs/Evaluation.md) | Metric definitions M-01…M-12, scenarios, evidence rules |
| [Risks](docs/Risks.md) | Risk register with triggers and fallbacks |
| [Rules](docs/Rules.md) | Permanent engineering rulebook |
| [DemoScript](docs/DemoScript.md) | Repeatable 10-min live demo + viva-safety list |
| [FinalReport](docs/FinalReport.md) | Results, traceability, limitations, future work, reproduction |
| [MobileApp](docs/MobileApp.md) | APK build/run, host resolution, emulator, release signing |

## 🚀 Current Status

**Phase 8 complete — all 8 software phases done (249/249 tests green), plus shipped Android APK.**

- Phase 1 Foundation: versioned packet schema, authoritative validator, 32-fixture corpus, feasibility spike.
- Phase 2 Sensing pipeline: nodes + relay + gateway over an abstract transport, deterministic faults.
- Phase 3 Prioritized delivery: critical-first queue, ack frames, bounded retries (19% → 73% delivery as budget grows under 40% loss, in-sim).
- Phase 4 Resilient routing: alternate relay + failure-triggered reroute, bounded relay buffer with backfill, `tools/resilience_demo.py`.
- Phase 5 Backend + dashboard: FastAPI envelope contract, SQLite + uniqueness constraint, WebSocket stream, React/Next.js dashboard (cards, trends, alerts, network, 3D twin).
- Phase 6 Edge intelligence: shared risk engine, node-local scoring with critical escalation, backend authority with evidence snapshots + config endpoints.
- Phase 7 Security: frame MAC, credential store, operator guard, audit trail (lab baseline).
- Phase 8 Evaluation: S-01…S-08 runner, M-01…M-12 from recorded runs, 40-session campaign, demo script, final report.
- Phase 8M Android APK: Capacitor 8 shell, CI release with rolling `latest` asset + QR (shipped 2026-10-05).

**Not yet built:** physical ESP32/ESP-NOW validation (deferred 2026-09-29, awaits hardware; resolve R-21 first). Proposed next: Phase 9 dep-scan & docs refresh — see [Phases](docs/Phases.md).

## 🤝 Contributing

Contributions are **greatly appreciated**. Please see our [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines and our [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md) for community rules.

## 📄 License

Distributed under the MIT License. See [.github/LICENSE](.github/LICENSE) for more information.

---

## ⚖️ Copyright, Attribution & Academic Integrity

**Copyright (c) 2026 Syed Ayan. All rights reserved.**

> ### 🎓 Notice Regarding Academic Submissions & Plagiarism
> This repository represents original research, implementation, and portfolio work created by **Syed Ayan** for healthcare IoT and edge mesh networks.
>
> - **Evaluation & Portfolio Use:** This codebase is publicly visible for prospective employers, technical recruiters, peer review, and individual educational study.
> - **Prohibition of Plagiarized Academic Submission:** You may **not** submit this project, its architecture, sensor simulator, firmware protocol, or substantial portions of its code/documentation as your own academic assignment, course project, dissertation, or degree requirement at any school, college, or university. Doing so violates institutional academic integrity policies and honor codes.
> - **Open-Source Terms:** Software distribution rights remain subject to the terms of the included [MIT License](.github/LICENSE), requiring mandatory preservation of original copyright notices and author attribution.
> - **Third-Party Rights:** All third-party libraries, hardware specifications, and dependencies remain the property of their respective owners.

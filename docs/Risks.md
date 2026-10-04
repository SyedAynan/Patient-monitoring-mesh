# Risk Register — Resilient Edge-Intelligence Patient Monitoring Mesh

**Status:** Living document, first pass
**Date:** 2026-09-28
**Phase:** Started in Phase 1, reviewed at every phase gate

This register satisfies the Phase 1 definition-of-done item *"hardware/protocol
risks and fallbacks documented"*. It supports `Phases.md` and does not override
`PRD.md`, `Architecture.md`, or `Rules.md`.

## 1. Scales and use

Impact: **High** = blocks the phase demo or the phase gate. **Medium** = degrades
quality or requires rework. **Low** = manageable within the phase.
Likelihood: **High** = expected without action. **Medium** = plausible.
**Low** = unlikely with the stated mitigation.

Each risk names a **trigger** — the observation that means the fallback is now
required. Fallbacks are the Phase 1 "decision rule" applied concretely: choose
the option that can be reliably demonstrated, measured, and explained.

Anything unresolved at a phase gate is carried into the final report's known
issues (Phase 8).

## 2. Hardware and radio risks

| ID | Risk | Phase | Impact | Likelihood | Mitigation | Fallback / trigger |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | ESP-NOW-style transport cannot be demonstrated as a multi-hop network: ESP-NOW is connectionless peer-to-peer and has no built-in routing | 1, 3, 4 | High | High | Treat relaying as an application-layer feature built on the node packet contract; measure relay behavior before making any mesh claim | Trigger: the two-node spike or relay test fails twice after fixes. Fallback: compare against Wi-Fi/802.15.4/Thread, or narrow the claim to single-hop with an explicit application relay and state the limitation honestly |
| R-02 | Radio range or 2.4 GHz interference in the classroom prevents reliable delivery at demo time | 3, 4, 8 | High | Medium | Keep nodes and gateway close, fix channel, cap sample rate, use a mains-powered relay | Trigger: delivery ratio visibly degrades in a live dry run. Fallback: add a relay node, reduce rate, or run the demo from the simulator with the hardware as a separate short demonstration |
| R-03 | No real-time clock on the ESP32; node time bases and clock drift | 2, 4 | Medium | High | Ordering and dedup by `(device_id, sequence_number)`; gateway receipt time recorded separately; document clock assumptions | Trigger: latency figures swing unexplainably between runs. Fallback: report latency only from single-clock experiments and mark radio latency as bounded/estimated |
| R-04 | Sensor accuracy and stability: motion and fit degrade HR/SpO2 readings on low-cost modules | 2, 6 | Medium | High | Signal-quality gating, mark invalid readings as invalid, treat quality as first-class metadata (`Design.md` section 9). Phase 2 implemented the gating: `SignalFilter` computes quality from window dispersion and the node skips a window below `MINIMUM_SIGNAL_QUALITY` instead of publishing it | Trigger: readings stay unusable after filtering work. Fallback: demonstrate with temperature plus simulator-driven vitals, and present the pulse-oximetry path as a measured limitation |
| R-21 | Envelope overhead versus the real radio budget: `MAX_PAYLOAD_LENGTH` exceeds ESP-NOW's 250-byte payload limit, so a frame that is valid in simulation may not fit on hardware | 3, 4 | High | High | Keep the envelope small and the limit explicit; measure real frame size against the radio's limit during the hardware spike | Trigger: a maximum-size packet exceeds the radio's payload limit. Fallback: shrink the envelope or fragment at the application layer; do not silently truncate telemetry |
| R-05 | Node memory and buffer bounds on the ESP32 | 2, 4 | Medium | Medium | Bounded ring buffers, explicit drop policy that never drops critical before routine, drop counts recorded (M-10) | Trigger: buffer-bound test (S-06) shows unexpected resets or corruption. Fallback: reduce buffered window to the measured safe bound and document the real capacity instead of the planned one |
| R-06 | Power supply, battery runtime, and thermal behavior during a long demo | 4, 8 | Medium | Medium | Mains power for gateway and relay; bounded soak runs (S-08) | Trigger: nodes reset or throttle during the soak run. Fallback: shorten the demonstration window and split long-run evidence into separate recorded runs |
| R-07 | Hardware procurement, shipping, or budget delay | 1 | High | Medium | Order early, keep the simulator as the standing fallback for every packet path (NFR-06) | Trigger: boards unavailable at the phase gate. Fallback: proceed on simulator evidence and mark the physical spike explicitly unverified; do not report simulated results as hardware results |
| R-08 | Missing PlatformIO/toolchain in a workspace, so firmware cannot be built or flashed there | 1, 2, 3 | Medium | High | Keep firmware build instructions in the repo; treat the simulator as the source of truth for contract behavior | Trigger: build environment unavailable before a demo. Fallback: pre-flash devices on a working machine and freeze firmware for the demo |

## 3. Software and architecture risks

| ID | Risk | Phase | Impact | Likelihood | Mitigation | Fallback / trigger |
| --- | --- | --- | --- | --- | --- | --- |
| R-09 | Additional services (Mosquitto broker, PostgreSQL) make the demo fragile on one laptop | 3, 5 | Medium | Medium | In-process transport paths first; keep transport adapters separate from domain logic (Architecture 5) | Trigger: broker instability during a dry run. Fallback: bypass the broker with direct in-process/HTTP ingestion for the lab demo, keeping the same domain and packet contract |
| R-10 | Packet contract drift between firmware, simulator, gateway, and backend | 2–5 | High | Medium | One authoritative validator (`shared/protocol/telemetry_packet.py`); unknown versions rejected safely; contract tests as the gate | Trigger: any component accepts a packet the validator rejects. Fallback: block the phase until the contract test suite covers the divergence |
| R-11 | Duplicate or out-of-order records during retries and recovery | 3, 4 | High | Medium | Sequence numbers, dedup by `(device_id, sequence_number)`, immutable measurement records, unique constraint | Trigger: S-07 shows duplicate rows or ordering violations. Fallback: add the uniqueness constraint/enforcement before any further phase work |
| R-12 | Frontend computes or displays authoritative-looking metrics it should not | 5 | Medium | Low | Backend is authoritative; frontend renders server values only (Architecture 4) | Trigger: a metric differs between API response and UI. Fallback: remove the client-side computation rather than reconciling the two |
| R-13 | Scope overrun across eight phases | all | High | Medium | One phase at a time; implement only the current phase (Rules 2); phase gates in `Phases.md` | Trigger: work starts on a later phase while the current gate is open. Fallback: stop the extra work, finish the gate, record the deferral in `Memory.md` |
| R-14 | Gateway host (Raspberry Pi/mini-PC) is a single point of the demonstration | 3, 5 | Medium | Low | Nodes keep local logic and buffering; gateway restart is a scripted scenario (S-03) | Trigger: gateway host fails before the demo. Fallback: run gateway and backend on the laptop as documented in Architecture section 15 |

## 4. Security, privacy, and compliance risks

| ID | Risk | Phase | Impact | Likelihood | Mitigation | Fallback / trigger |
| --- | --- | --- | --- | --- | --- | --- |
| R-15 | Spoofed node, tampered packet, or replay: Phase 1 validates identity shape and sequencing only | 1–6 | Medium | Medium | **Phase 7 partially addressed:** frames now carry HMAC-SHA256 over immutable fields, the gateway verifies before parsing (fail closed, no ack for rejects), devices are provisioned/revocable, and a replay signal counts far-below-water-mark sequences without suppressing backfill. Lab master key is seed-derived — a lab baseline, not production hardening | Trigger: any requirement to move beyond a trusted lab network. Fallback: TLS story, per-device key distribution, and rotation tooling must be completed before any such deployment; until then the limitation is stated in the README and in the demo |
| R-16 | Prototype output misread as clinical diagnosis or as a certified device | all | High | Medium | Persistent prototype banner, non-clinical labeling, no clinical claims in code, docs, or demo script (NFR-07, FR-11) | Trigger: any wording that implies diagnosis or certification. Fallback: correct the wording immediately and treat it as a defect |
| R-17 | Accidental collection or commit of real patient data or secrets | all | High | Low | Synthetic data only, `.env` ignored, local-only credentials, no secrets in logs | Trigger: any real data or credential found in the repository or logs. Fallback: remove it, rotate the credential, and record the incident |

## 5. Project-process risks

| ID | Risk | Phase | Impact | Likelihood | Mitigation | Fallback / trigger |
| --- | --- | --- | --- | --- | --- | --- |
| R-18 | Protocol and failure behavior cannot be explained in a viva | all | High | Medium | Documented decisions with reasons (`Architecture.md`), measured evidence (`Evaluation.md`), no claim beyond what was measured | Trigger: a design question cannot be answered from the docs. Fallback: complete the documentation before starting the next phase |
| R-19 | Documentation and implementation drift apart | all | Medium | Medium | Update `docs/` and `Memory.md` in the same change as the code; docs are a phase deliverable | Trigger: docs describe behavior the tests contradict. Fallback: fix docs first, then continue |
| R-20 | Reported results outrun the measured evidence (unrun tests, estimated metrics) | all | High | Medium | Report only recorded runs; `[TBD]` for anything unmeasured; never claim a test passed without running it (Rules 13, 19) | Trigger: a number appears in a report without an evidence file. Fallback: remove the number or mark it explicitly unverified |

## 6. Current open risks

- **R-01** remains the highest-value unknown: whether ESP-NOW can relay at all,
  given it is connectionless peer-to-peer with no built-in routing. Phase 2
  implemented application-level relaying over an abstract transport, which proves
  the *application* handles a second hop but proves nothing about the radio. The
  risk stays open until the physical spike runs.
- **Physical validation is deferred** as of 2026-09-29 (user decision). R-01,
  R-02, R-07, and R-08 are therefore all deferred together, not closed. Nothing
  in the physical-transport column may be reported as validated.
- **R-07** and **R-08** are active: no boards and no PlatformIO toolchain in this
  workspace, which is why the simulator is the documented fallback.
- **R-04** was partially addressed in Phase 2 (quality gating and plausibility
  checks implemented); the underlying sensor-accuracy question stays open until a
  physical pulse-oximetry module is tested.
- **R-21** is newly identified in Phase 2 and must be resolved before firmware
  work starts.
- **R-13** (scope overrun) is being watched: the README briefly described Phases
  1–4 as complete when only 1 and 2 are. Status wording must follow the phase
  table in `docs/Phases.md`, not the badge.
# Evaluation — Resilient Edge-Intelligence Patient Monitoring Mesh

**Status:** Method defined; no measurements collected yet
**Date:** 2026-09-28
**Phase:** Defined in Phase 1, applied in Phases 3–8

This document defines *how* the prototype is measured. It supports `Phases.md`
and does not override `PRD.md`, `Architecture.md`, or `Rules.md`.

## 1. Purpose and non-claims

The project is graded on demonstrable network behavior, not on feature count.
This document makes each claim checkable: what is measured, how, under what
configuration, and with what known error.

No metric in this document has been measured yet. **A number may only be
reported as measured when it comes from a recorded experiment run that produced
an export file under the evidence path in section 7.** Estimated, simulated, and
planned values must be labeled as such (Rules 13).

Phase 1 currently produces feasibility observations only, from the simulator
stand-in described in `simulator/README.md`. Those observations are not
evaluation metrics.

## 2. Measurement principles

1. Every reported number names its configuration, run count, and source file.
2. Metrics are computed by the backend/experiment runner, never by the dashboard
   (`Architecture.md` section 4).
3. Nothing is discarded silently: dropped, duplicated, rejected, and out-of-order
   records are counted and reported, not filtered out of the totals.
4. Missing data caused by network failure is preserved as a gap. Gaps are
   evidence, not noise to be smoothed (`Design.md` section 10).
5. Experiments use synthetic or simulator data only. No real patient data.
6. A run is reproducible: seed, node count, rates, and failure timings are stored
   with the results.
7. If a metric cannot be measured with available hardware, report it as `[TBD]`
   with the reason, rather than substituting an estimate.

## 3. Metric definitions

| ID | Metric | Definition | Unit | Target | Measured from |
| --- | --- | --- | --- | --- | --- |
| M-01 | Packet delivery ratio | Unique measurements persisted or received at the gateway ÷ measurements emitted by nodes | % | Not numerically targeted; reported per scenario | Node emit log + gateway records |
| M-02 | Routine end-to-end latency | Gateway receipt time − node capture time (see section 4) | ms | Informational | Packet timestamps |
| M-03 | Critical alert delivery latency | Time from node marking a packet `critical` to alert visible in the dashboard | ms | ≤ 3000 (NFR-02) | Node event log + dashboard/backend event record |
| M-04 | Duplicate and retry rate | Retransmitted frames received ÷ total frames received | % | Reported; duplicates must not create duplicate records (FR-05) | Gateway counters |
| M-05 | Reroute time | Time from path/relay failure to first packet arriving over an alternate path | ms | Reported per scenario | Route-change events (NFR-03) |
| M-06 | Recovery completeness | Buffered records synchronized after reconnect ÷ buffered records expected | % | Reported per scenario (FR-06) | Node buffer log + backend records |
| M-07 | Throughput | Successfully delivered measurements per second, sustained | records/s | Reported at 6-node load | Gateway records over time window |
| M-08 | Stale detection time | Time from last received packet to `stale` state in the UI | s | Within configured timeout (FR-03) | Backend device state + dashboard timestamp |
| M-09 | Dashboard freshness | Time from gateway receipt to visible dashboard update | ms | ≤ 2000 (NFR-01) | Gateway timestamp + client render timestamp |
| M-10 | Buffer occupancy and drops | Peak buffered records per node; records dropped because the buffer bound was reached | records | Bounded, no unbounded growth (Rules 9) | Node diagnostics |
| M-11 | Protocol error rate | Frames rejected as malformed, invalid, or unsupported-version ÷ frames received | % | Reported; rejection must be safe | Gateway validation counters |
| M-12 | Traceability coverage | Stored measurements resolvable to device, timestamp, and sequence number | % | 100 (NFR-04) | Backend records |

M-01 through M-08 and M-11 belong to Phases 3–4. M-09 and M-12 belong to Phase 5.
Every metric keeps its supporting counts (emitted, delivered, dropped,
duplicated, rejected) so ratios can be recomputed and checked.

## 4. Time basis and clock handling

- Nodes are not assumed to have a real-time clock. Node timestamps are capture
  times on the node's own time base.
- Ordering and deduplication rely on `(device_id, sequence_number)`, never on
  wall-clock comparison between nodes (`shared/protocol/README.md`).
- Latency measured across two physical devices carries clock-offset error. Any
  such figure is reported with the offset assumption stated.
- Simulator and single-host experiments share one clock and therefore give the
  cleaner latency figure. Results from the two setups are never mixed in one
  table.
- Gateway receipt time is recorded separately from node capture time so
  clock-skew impact can be assessed later.
- All stored timestamps are UTC; conversion happens only in the UI.

## 5. Experiment scenarios

Each scenario is a separate recorded run. Scenario IDs are stable for reference
in the final report.

| ID | Scenario | Intent | Phase |
| --- | --- | --- | --- |
| S-01 | Baseline steady state | Reference figures for delivery, latency, throughput | 3 |
| S-02 | Relay node power-off | Route change, reroute time (M-05) | 4 |
| S-03 | Gateway interruption | Local-first operation, buffering, later sync (M-06) | 4 |
| S-04 | Six-node congestion | Priority behavior, routine vs critical, throughput (M-03, M-07) | 3 |
| S-05 | Node power loss | Stale detection and recovery of that node (M-08) | 3 |
| S-06 | Buffer-bound overflow | Bounded memory behavior and drop accounting (M-10) | 4 |
| S-07 | Recovery with duplicates and out-of-order arrival | Deduplication correctness (M-04, M-06) | 4 |
| S-08 | Extended soak run | Stability, memory growth, drift over a longer window | 4 |

Failure injection uses explicit controls in the experiment console (Phase 8), not
manual unplugging, wherever a control exists.

## 6. Experiment method

1. Fix the configuration: node count, sample interval, transport, priority
   policy, failure timings, buffer bounds, seed.
2. Discard a warm-up window before the measurement window; state its length.
3. Run the scenario for a stated duration.
4. Repeat each scenario at least 5 times.
5. Report the median with the minimum and maximum across runs, plus the run
   count. A single run is reported as a single observation, never as a result.
6. State anomalies and outliers explicitly instead of removing them.
7. Re-run after any change to packet handling, transport, or thresholds; stale
   numbers are not carried forward.

Until the backend experiment runner exists (Phase 8), runs are executed manually
and their configuration recorded in the session notes.

## 7. Evidence storage

Raw experiment evidence is written outside source control, under the configured
data directory (`DATA_DIR`, default `.data/`, already git-ignored):

```text
.data/experiments/<session-id>/
  config.json    # exact configuration and seed
  raw.jsonl      # one record per emitted/received packet
  summary.json   # computed metrics with run counts
  notes.md       # anomalies, manual actions, environment
```

`<session-id>` is `YYYY-MM-DD-<scenario-id>-<run>`, for example
`2026-10-04-S-02-3`. Files are written by the experiment tooling and are never
hand-edited; corrections are recorded in `notes.md`.

## 8. Result table template

Summary tables in the final report use this shape:

| Scenario | Run count | M-01 (%) | M-03 (ms, median) | M-05 (ms, median) | M-06 (%) | Anomalies |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | [TBD] | [TBD] | [TBD] | n/a | n/a | [TBD] |

`[TBD]` cells stay `[TBD]` until a recorded run fills them.

## 9. Traceability

| Requirement | Metric | Scenario |
| --- | --- | --- |
| FR-03 stale/disconnected detection | M-08 | S-05 |
| FR-04 critical priority over routine | M-03 | S-04 |
| FR-05 no duplicate records | M-04 | S-07 |
| FR-06 buffering across ≥5 min loss | M-06 | S-03 |
| FR-08 network metrics recorded | M-01…M-11 | all |
| NFR-01 dashboard ≤2 s | M-09 | S-01 |
| NFR-02 critical alert ≤3 s | M-03 | S-04 |
| NFR-03 usable with one relay unavailable | M-05 | S-02 |
| NFR-04 traceable measurements | M-12 | S-01 |

## 10. Known measurement limitations

- Physical-radio figures are single-lab-environment results, not generalizable
  performance claims.
- 2.4 GHz interference and classroom radio conditions vary between sessions; the
  environment is noted per session.
- Clock offset between real devices limits latency precision (section 4).
- Six nodes is a small sample; averages over few nodes are indicative only.
- Risk scoring (Phase 6) is prototype logic. Any false-positive/false-negative
  figures describe synthetic scenarios, not clinical accuracy.
- No metric in this project constitutes clinical validation.
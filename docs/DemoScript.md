# Live Demo Script — Patient Monitoring Mesh

**Status:** Repeatable, Phase 8
**Audience:** classroom / viva demonstration
**Duration:** ~10 minutes

Every command here is deterministic (fixed seeds). Run the whole script before
the demo once to confirm your environment. All data shown is **simulated and
non-clinical** — say so out loud at the start and at the end.

---

## 0. Setup (before the audience arrives)

Two terminals, repository root.

```bash
# Terminal A — the backend + simulator
python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000

# Terminal B — the dashboard
cd frontend && npm run dev    # http://localhost:3000
```

Checks: `/health` returns `status: ok`; the dashboard header shows
**Connected**; the prototype banner is visible on every page.

Optional, for the authenticated variant (Phase 7):

```bash
# Terminal A instead:
MESH_AUTH=1 BACKEND_AUTH_MODE=token OPERATOR_TOKEN=$(python -c "import secrets; print(secrets.token_urlsafe(24))") \
  python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000
```

---

## 1. Opening (1 min)

- Dashboard on screen: five patient cards, all **Normal**, connection dot green.
- Say: *"This is an educational prototype running fully simulated, non-clinical
  data. The mesh that moves the data is simulated too — physical ESP32/ESP-NOW
  validation is deferred until we have hardware."*

## 2. Normal operation (2 min)

- Watch patient-04 (the **deteriorating** profile): over ~2 minutes its heart
  rate trends up and SpO₂ trends down.
- Point out, when it happens: the risk badge escalates **Normal → Attention →
  Critical**, and the alert that appears names the rule that fired, the value,
  and the threshold — the evidence, not just a color.
- Acknowledge the alert from the Alerts page (say "operator action").
- Under the hood: the node scored the risk locally (Phase 6) and sent those
  packets with `priority: critical`, so they moved ahead of routine traffic
  (Phase 3). The dashboard only renders what the backend computed.

## 3. Network resilience — the centerpiece (4 min)

Keep the dashboard visible; use Terminal A (or a third terminal) for the
failure demos:

```bash
python tools/resilience_demo.py
```

Narrate the two scenarios it prints:

- **S-02 relay power-off:** the primary relay loses every link; every node
  reroutes to the alternate relay within a few seconds and delivery continues.
  *"One relay down, monitoring continues — that is NFR-03."*
- **S-03 gateway interruption:** with the gateway unreachable the relay
  buffers frames — say *"monitoring continues locally, nothing is lost"* —
  and on recovery **15/15 buffered frames are backfilled with zero duplicate
  records**. *"That is store-and-forward, Phase 4."*

Then show the recorded-experiment discipline:

```bash
python tools/run_experiments.py --scenarios S-02 --runs 3 --date demo
ls .data/experiments/demo-S-02-1/
```

- Open `.data/experiments/` and show one session directory:
  `config.json` (exact configuration + seed), `raw.jsonl` (one event per
  line), `summary.json` (metrics computed from those records), `notes.md`.
- Say: *"No metric in this project is reported without an evidence directory
  like this one."*

## 4. Security baseline (2 min)

With the optional authenticated backend from setup:

- Show `/health` reporting `auth_mode: token` (never the token itself).
- Try acknowledging an alert without the token → **401**; with the token → 200.
- Say: *"Unknown or revoked devices are rejected before their payloads are
  even parsed — fail closed. Every decision lands in the audit trail."*
- Honest limit, said plainly: *"This is a lab baseline — the demo key is
  seed-derived, there's no TLS story yet. Not production security."*

## 5. The evaluation results (1 min)

- Open `.data/experiments/campaign-2026-10-04.md` (the recorded campaign).
- Point at S-03's M-06 row: recovery completeness, median/min/max across 5
  runs, from recorded evidence.
- Say: *"Latency and throughput figures are simulated single-clock values —
  they measure queue, retry, and backfill behavior, not radio propagation.
  The radio numbers wait for hardware."*

## 6. Close (30 s)

- One sentence per phase: contract and fixtures → simulated mesh → priority
  delivery with acks → store-and-forward → backend and dashboard →
  explainable risk → security baseline → recorded evaluation.
- Final line: *"Everything you saw is measured or it's labeled simulated.
  It is a prototype, not a medical device, and the report says so."*

---

## Failure recovery

| If this happens | Do this |
| --- | --- |
| Dashboard shows Disconnected | Check Terminal A is still running; the socket auto-reconnects with backoff — show the banner, that's a feature (stale-data handling). |
| A patient card goes Stale | Intended behavior after ~12 s without data; say "stale detection" and point at the explicit last-seen time. |
| Demo-mode audio startsle | `Volume2/VolumeX` toggle, top right. |
| Terminal A crashed | Restart the command; the dashboard reconnects on its own. Historical data returns from SQLite. |

## What NOT to claim (viva safety)

- No clinical validation, no diagnosis, no medical-device certification.
- No measured radio performance — ESP-NOW on hardware is untested and deferred.
- No production security.
- Not a self-healing mesh: it is two-path failover, measured, on a simulated link.

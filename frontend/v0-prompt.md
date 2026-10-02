# v0 dashboard prompt

Paste into v0.dev to generate the dashboard. The API contract below matches the
backend implemented in `backend/` — after generation, point the `api/` client's
base URL at `http://127.0.0.1:8000` and the realtime client at
`ws://127.0.0.1:8000/api/v1/realtime`, then delete the mocks.

Run the backend with:

```bash
python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000
```

---

Build a real-time multi-patient monitoring dashboard for an academic MedTech + IoT project, "Patient Monitoring Mesh". It is a calm, trustworthy operations console — information-dense, not alarming — for watching simulated patients whose sensor nodes send vital-sign telemetry over a local mesh network. Stack: React 18 + TypeScript (strict) + Tailwind CSS + shadcn/ui + Recharts. Next.js App Router is fine, but use no server logic: all data flows through a typed API client module that will later point at a real backend.

NON-NEGOTIABLE RULES

- A persistent, unobtrusive banner on every page: "Educational prototype — simulated, non-clinical data. Not for diagnosis."
- Never communicate severity by color alone: always text + icon.
- Chart gaps caused by missing data must render as visible gaps — never interpolate or smooth across them.
- The frontend never computes medical or network metrics; it renders backend values only.
- Design every state: loading skeletons, empty, error, stale, disconnected, success.

DESIGN TOKENS (exact values)

:root {
  --color-bg: #f5f7fa; --color-surface: #ffffff; --color-surface-muted: #eef2f6;
  --color-text: #17212b; --color-text-muted: #5c6b78; --color-border: #d7e0e8;
  --color-primary: #155eef; --color-primary-hover: #0f4dcc; --color-info: #0284c7;
  --color-success: #16803c; --color-warning: #b7791f; --color-danger: #c53030;
  --color-critical-bg: #fff1f1; --color-focus: #7c3aed;
}

Typography: system-ui stack. Body 14–16px; page title 24–32px/700; section title 18–20px/650–700; card title 15–16px/600; metadata 12–13px muted; vital values 20–28px/650 with tabular numerals and explicit units (bpm, %, °C).

Spacing: 4px scale (4/8/12/16/20/24/32/40/48). Radius: 6px controls, 10px cards/inputs, 14px panels. Card shadow 0 1px 3px rgba(23,33,43,0.08); modal 0 12px 32px rgba(23,33,43,0.18). Transitions 120–200ms; respect prefers-reduced-motion.

LAYOUT

Header: product name, "LOCAL DEMO" badge, connection indicator (dot + "Connected / Reconnecting / Disconnected"), "last synced HH:MM:SS", prototype badge. Left nav: Overview, Patients, Network, Alerts — active item has text + indicator; never hide critical status behind a menu.

PAGES

1. Overview — responsive card grid, one card per patient: patient label, status badge (Normal / Attention / Critical / Stale / Offline — text + icon), latest HR (bpm), SpO₂ (%), temperature (°C), signal-quality bar (0–1), last-seen time, link to detail.
2. Patient detail — header with status; three trend charts (HR, SpO₂, temperature) with units, time-range selector (15m / 1h / 6h), gap rendering for missing data, critical-event markers; measurements table (time, HR, SpO₂, temp, quality, sequence number); this patient's alerts with Acknowledge buttons.
3. Network — nodes online/total, delivery ratio (render "—" when null), recent events list (route_change, disconnect, reconnect, buffer_backfill with device + time), per-device last-seen table.
4. Alerts — filterable table (severity, patient, message, raised time, status active/acknowledged); Acknowledge action; active alerts highlighted without celebratory styling.

API CONTRACT (mock it exactly; the real backend will replace only the base URL)

- Every REST response is an envelope: { "data": ..., "error": null } or { "data": null, "error": { "code": "STRING_CODE", "message": "...", "details": {} } }.
- GET /api/v1/devices → { items: [{ device_id, patient_id, role: "node"|"relay"|"gateway", status: "online"|"stale"|"offline", last_seen_at_ms, signal_quality }] }
- GET /api/v1/patients/{patient_id}/measurements?from_ms&to_ms&limit → { items: [{ device_id, patient_id, sequence_number, captured_at_ms, heart_rate_bpm, spo2_percent, temperature_c, signal_quality, priority: "routine"|"critical", risk: { level: "normal"|"attention"|"critical", score: 0–100 } | null }] } — ascending by captured_at_ms.
- GET /api/v1/alerts?status=active|acknowledged → { items: [{ alert_id, severity: "critical"|"warning", device_id, patient_id, message, raised_at_ms, acknowledged_at_ms, acknowledged_by }] }
- POST /api/v1/alerts/{alert_id}/acknowledge → the updated alert.
- GET /api/v1/network/metrics → { nodes_total, nodes_online, delivery_ratio, alert_latency_ms_p50, recent_events: [{ event_id, type, device_id, at_ms, detail }] } — null values are allowed; render "—".
- WebSocket /api/v1/realtime, server-pushed messages: { type: "measurement" | "alert" | "device_status" | "network_event", payload }.
- Mock client behaviour: 4 patients (patient-01…04 on node-01…04); one measurement every ~2–3 s per patient; HR 64–96 bpm with occasional excursions to 130–160 flagged priority "critical" and risk level "critical"; SpO₂ 93–99%; temp 36.4–37.8 °C; signal quality 0.6–1.0; sequence numbers strictly increasing per device; UTC epoch-ms timestamps. Every ~30 s drop the socket and auto-reconnect with exponential backoff; while disconnected show a persistent banner "Connection lost — displayed data may be outdated (last update Xs ago)". If a patient stops sending for > 12 s its status becomes "Stale" with muted treatment and an explicit last-seen time.

CODE SHAPE

TypeScript strict; named exports (default exports only where the router requires it); keep api/ (typed client + envelope handling) and realtime/ (socket + reconnect policy) as the only modules touching the network, so swapping mocks for the real backend changes nothing else; presentational components receive already-shaped props; WCAG AA contrast, full keyboard navigation, visible focus ring using --color-focus, aria-labels on icon-only buttons and chart summaries.
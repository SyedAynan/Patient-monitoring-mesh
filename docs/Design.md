# Design System — Resilient Edge-Intelligence Patient Monitoring Mesh

**Status:** Initial design direction
**Date:** 2026-09-28

## 1. Design philosophy

The interface should feel like a calm, trustworthy operations console: information-dense but not alarming, technical but understandable, and explicit about simulated/prototype data. Visual hierarchy should help an operator answer three questions fast:

1. Is any patient/node in an urgent state?
2. Is the network delivering data reliably?
3. What changed recently, and why?

Avoid hospital-brand imitation, decorative medical imagery, and false clinical authority.

## 2. Design tokens

Use CSS variables or the chosen UI system's token mechanism. Never scatter raw values through components.

### Colors

```css
:root {
  --color-bg: #f5f7fa;
  --color-surface: #ffffff;
  --color-surface-muted: #eef2f6;
  --color-text: #17212b;
  --color-text-muted: #5c6b78;
  --color-border: #d7e0e8;
  --color-primary: #155eef;
  --color-primary-hover: #0f4dcc;
  --color-info: #0284c7;
  --color-success: #16803c;
  --color-warning: #b7791f;
  --color-danger: #c53030;
  --color-critical-bg: #fff1f1;
  --color-focus: #7c3aed;
  --color-on-dark: #ffffff;
}
```

Severity colors must always be paired with text, icon, or pattern. Never rely on color alone.

### Typography

- Preferred UI font: system sans stack for reliability; custom font is **[TBD]**.
- Body: 14–16px.
- Page title: 24–32px, weight 700.
- Section title: 18–20px, weight 650–700.
- Card title: 15–16px, weight 600.
- Metadata: 12–13px, muted color.
- Numeric vital values: tabular numerals, 20–28px, weight 650.
- Line height: 1.4–1.6 for body text.

### Spacing

4px base scale: `4, 8, 12, 16, 20, 24, 32, 40, 48`.

### Radius

- Small controls: 6px.
- Cards/inputs: 10px.
- Large panels: 14px.
- Avoid pill shapes except for statuses/tags.

### Shadows and borders

- Prefer borders and subtle shadows over floating panels.
- Default card shadow: `0 1px 3px rgba(23, 33, 43, 0.08)`.
- Elevated modal shadow: `0 12px 32px rgba(23, 33, 43, 0.18)`.

## 3. Layout

### Desktop
- Persistent left navigation or compact rail: **[TBD]**.
- Header with page title, connection state, prototype banner.
- Main content on a responsive grid.
- Urgent alerts visible without deep navigation.

### Mobile/tablet
- Collapse navigation into a menu.
- Stack patient cards and metric panels.
- Keep alert summary, connection state, and selected patient accessible.
- Horizontal scrolling only for dense charts/tables with no accessible alternative.

## 4. Navigation

Primary areas:

- Overview
- Patients
- Network
- Experiments
- Alerts
- Settings/Devices **[TBD]**

Active navigation needs text plus a visual indicator. Do not hide critical status behind a menu.

## 5. Header

Include:

- Product name.
- Environment badge: `LOCAL DEMO` or equivalent.
- Gateway/backend connection state.
- Last synchronized time.
- Optional user/session menu if authentication is enabled.

## 6. Cards and panels

Patient cards show:

- Patient/node label.
- Current risk state with text.
- Latest heart rate, SpO2, temperature where available.
- Signal quality.
- Last seen time.
- Connection state.
- Link to detail view.

Network cards show:

- Nodes online/offline.
- Packet delivery ratio.
- Alert latency.
- Active route/recovery event.

Cards support skeleton, empty, stale, error, and populated states.

## 7. Buttons

- Primary: filled primary color, one main action per region.
- Secondary: outlined or neutral filled, supporting actions.
- Destructive: danger styling plus explicit confirmation for irreversible actions.
- Icon-only buttons need accessible labels and tooltips.
- Disabled buttons explain why when the reason is not obvious.

## 8. Inputs and forms

- Labels always visible; never rely on placeholders.
- Show units beside vital thresholds.
- Validate on submit with inline, specific errors.
- Clearly mark simulated/test controls.
- Guard and document unsafe or clinical-sounding configuration.

## 9. Alerts and status

Status vocabulary:

- `Normal`
- `Attention`
- `Critical`
- `Stale`
- `Offline`
- `Invalid signal`
- `Recovering`

Every alert includes severity, timestamp, source, evidence/summary, acknowledgement state. Do not use unexplained "healthy" labels when data is incomplete.

## 10. Tables and charts

- Readable headers, alignment, sorting labels, responsive alternatives.
- Charts show units, time range, missing-data gaps, source status.
- Critical events annotated on timelines.
- Consistent series colors, accessible contrast.
- Do not smooth away gaps caused by network failure — gaps are part of the evaluation.

## 11. Modals and confirmations

- Modals for focused configuration or experiment confirmation.
- Do not put routine information in modals.
- Confirm destructive actions and failure injection.
- Keyboard close and focus return.

## 12. Empty, loading, error, success states

### Empty
Explain what is missing and give the next safe action, e.g. "No nodes connected. Start a simulator or provision a device."

### Loading
Skeletons for layout plus a short status label; avoid context-free indefinite spinners.

### Error
State what failed, whether existing data is stale, how to retry. Never show raw stack traces.

### Success
Concise confirmation with timestamp or resulting state. No celebratory styling on clinical alerts.

### Disconnected/stale
Persistent banner or badge, last known timestamp, explicit statement that displayed data may be outdated.

## 13. Animation and interaction

- Short transitions (120–200ms) for hover, focus, panel changes.
- Subtle pulse only for a newly received critical event, never continuous.
- Respect `prefers-reduced-motion`.
- Never animate live values so aggressively that reading becomes hard.

## 14. Accessibility

- Target WCAG AA contrast.
- Keyboard navigation for all actions.
- Visible focus ring using `--color-focus`.
- Semantic headings and landmarks.
- Screen-reader text for status icons and chart summaries.
- Never communicate severity through color alone.
- Readable minimum sizes on projected classroom screens.

## 15. Prototype disclosure

A visible, non-intrusive banner states that the system is an educational prototype using simulated/non-clinical data, not for diagnosis or treatment. This banner must remain present in demo mode.
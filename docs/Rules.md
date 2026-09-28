# Engineering Rules — Resilient Edge-Intelligence Patient Monitoring Mesh

**Status:** Permanent project rulebook
**Date:** 2026-09-28

## 1. Source of truth

When documents conflict, follow this order:

1. Current explicit user instruction.
2. `PRD.md`.
3. `Architecture.md`.
4. `Rules.md`.
5. `Phases.md`.
6. `Design.md`.
7. `Memory.md`.

When a requirement is unknown, write `[TBD]` rather than inventing it.

## 2. Scope control

- Implement only the current phase.
- Do not build future features early.
- Do not rewrite unrelated code.
- Do not delete working code without explaining why.
- Prefer the smallest change that satisfies the Definition of Done.

## 3. Coding style

- Prefer clear, boring, maintainable code over clever abstractions.
- Match the surrounding code's naming, comments, and formatting.
- Use strict TypeScript where TypeScript is selected.
- Prefer named exports; avoid default exports unless the framework requires one.
- Keep functions focused and side effects explicit.
- Prefer composition over inheritance.
- Make units, timestamps, and priority semantics explicit.
- Store timestamps in UTC; convert only at presentation boundaries.

## 4. Naming

- Components/types/classes: `PascalCase`.
- Functions/variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for true constants only.
- Files: follow the selected stack's convention consistently.
- Database tables/columns: `snake_case`.
- API paths: lowercase plural nouns, versioned.
- Packet fields: stable, documented, versioned names.

## 5. File organization

- Keep frontend, backend, firmware, simulator, and docs separated.
- Keep tests next to the source they test unless the toolchain requires a test directory.
- Keep transport adapters separate from domain logic.
- Do not create a file for a one-line abstraction with no clear reuse case.

## 6. Components and UI

- One clear responsibility per component.
- Reuse shared loading, empty, error, status, table, and form components.
- Keep domain data transformation out of presentational components where possible.
- Design all states: loading, empty, error, disconnected, stale, success.
- Never imply diagnosis or clinical certainty in labels or through color alone.

## 7. API conventions

- Use `{ data, error }` for every API response.
- Validate request bodies, query parameters, route parameters, response shapes.
- Use stable error codes and appropriate HTTP status codes.
- Version public API routes.
- Keep handlers thin; call domain services.
- Make retries safe with sequence numbers, idempotency, or deduplication.

## 8. Database conventions

- Use migrations for schema changes.
- Use UTC timestamps and explicit indexes.
- Enforce uniqueness for device identity and packet sequence where appropriate.
- Never silently delete telemetry.
- Use foreign keys and check constraints where they express real invariants.
- Keep test/demo data separate from real data.

## 9. Embedded and networking rules

- Every packet carries device ID, protocol/schema version, timestamp or time basis, sequence number, priority, quality metadata.
- Bound all buffers and queues.
- Define retry limits and failure behavior explicitly.
- Never let routine traffic starve critical alerts.
- Record route, retry, drop, duplicate, reconnect events.
- Do not call a protocol "self-healing mesh" until node-failure and reroute behavior is measured.
- Design for clock drift and out-of-order delivery.
- Provide a simulator for every hardware-dependent packet path.

## 10. Security

- Never hardcode secrets, credentials, private keys, or tokens.
- Never commit `.env` files or real patient data.
- Authenticate devices and validate packet freshness.
- Use encryption for data in transit where supported.
- Apply least privilege.
- Do not log secrets or sensitive payloads.
- Treat all device input and external messages as untrusted.
- Document prototype limitations; never claim clinical certification.

## 11. Authentication and authorization

- Enforce authorization on the server/gateway.
- Separate viewer, operator, and administrator permissions if accounts exist.
- Use secure session/token handling and password hashing.
- Revoke or disable unknown devices.
- Avoid adding authentication complexity before the MVP decision is made.

## 12. Validation and error handling

- Validate at boundaries; return actionable errors.
- Fail closed for authentication and malformed packets.
- Use timeouts and bounded retries.
- Preserve debugging context without exposing sensitive information.
- Never swallow errors silently.
- Distinguish unavailable, stale, invalid, and abnormal-but-simulated states.

## 13. Logging and observability

- Structured logs: timestamp, component, severity, correlation/session ID, safe context.
- Log packet lifecycle and network experiments.
- Health/readiness checks for services.
- Useful during a live demo without flooding the console.
- Never claim a metric was measured when it was not.

## 14. Testing

- Unit tests for domain logic and packet parsing.
- Test invalid input, duplicates, retries, out-of-order packets, disconnects, recovery.
- Deterministic fixtures for risk scoring and simulators.
- Integration tests at gateway/backend boundaries.
- Run tests, type checks, lint, and build as applicable after each phase.
- Test the failure path, not only the happy path.

## 15. Accessibility and UX

- Semantic HTML, keyboard-accessible controls.
- Never rely on color alone for severity.
- Readable labels, focus states, sufficient contrast.
- Usable on laptop and tablet widths.
- Make stale/disconnected data obvious.

## 16. Performance

- Bound client subscriptions and chart history.
- Avoid rerendering the whole dashboard for one measurement.
- Batch/aggregate high-frequency data where appropriate.
- Measure before optimizing.
- Keep embedded loops non-blocking; avoid unbounded memory growth.

## 17. Responsive design

- Build mobile/tablet behavior intentionally.
- Preserve critical status and alert info at narrow widths.
- Use responsive tables or alternate cards where needed.
- Keep touch targets usable.

## 18. Dependencies

- Before adding a library, check whether the current stack already provides the functionality.
- Prefer mature, focused dependencies with active maintenance and compatible licenses.
- Do not install libraries for trivial helpers.
- Record why a non-obvious dependency is needed.
- Keep firmware dependencies minimal; pin versions where practical.

## 19. Git practices

- Small, focused commits.
- Conventional commit messages.
- Never commit generated secrets, logs, binaries, or personal data.
- Review the diff before committing.
- Keep docs and implementation aligned.
- Never claim tests passed without running them.

## 20. Environment and secrets

- Maintain `.env.example` with safe placeholders.
- Document required variables and defaults.
- Use local-only credentials for demos.
- Rotate compromised credentials immediately.
- Keep environment-specific configuration out of source code.

## 21. Reuse and duplication

- Reuse existing architecture, components, schemas, utilities.
- Create shared abstractions only when multiple real consumers exist.
- Avoid copy-pasted validation, status mapping, and API response handling.
- One authoritative definition for packet schemas and design tokens.

## 22. Required behavior for future AI work

### DO
- Read relevant docs and `Memory.md` before implementation.
- Inspect existing code before changing it.
- Reuse existing architecture and components.
- Keep types strict.
- Validate inputs and handle errors properly.
- Keep security and clinical limitations visible.
- Implement one phase/task at a time.
- Update `Memory.md` once implementation begins.
- Report files changed, checks run, remaining issues, next task.

### DO NOT
- Randomly change architecture.
- Install unnecessary libraries.
- Duplicate functionality.
- Hardcode secrets.
- Delete working code without reason.
- Create unnecessary files.
- Rewrite unrelated parts of the project.
- Implement features outside the current phase.
- Hide stale, disconnected, simulated, or uncertain data.
- Present prototype output as a medical diagnosis.
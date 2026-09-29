# Telemetry Protocol v1

`TelemetryPacketV1` is the transport-neutral contract shared by firmware, simulator, gateway, and tests.

## Required fields

- `schema_version`: integer protocol version.
- `packet_type`: currently `telemetry`.
- `device_id`: stable node identity, for example `node-01`.
- `patient_id`: simulated assignment, for example `patient-01`.
- `sequence_number`: monotonically increasing per device; used for ordering and deduplication.
- `captured_at_ms`: node capture time in Unix epoch milliseconds.
- `priority`: `routine` or `critical`.
- `signal_quality`: normalized value from `0.0` to `1.0`.
- `measurements`: HR, SpO2, and temperature in explicit units.
- `risk`: optional local status with level and score.

## Conformance fixtures

`fixtures/` holds the language-neutral conformance corpus that every
implementation must satisfy — firmware, simulator, gateway, and backend alike:

- `fixtures/valid/*.json` — canonical packet bytes. Decoding and re-encoding a
  valid fixture must reproduce the file **byte for byte**.
- `fixtures/invalid/*.json` — inputs that must be rejected with the exact
  `error_code` listed in `manifest.json`, and must never crash a receiver.
- `fixtures/manifest.json` — the list of fixtures with `expect` and, for invalid
  entries, the required `error_code`.

Regenerate after a deliberate contract change:

```bash
python tools/generate_fixtures.py
```

Fixtures are generated from the same builder the runtime uses, so they cannot
drift from the validator, and the generator fails loudly if a fixture stops
round-tripping or stops being rejected. Generated files are committed: firmware
reads them as static bytes rather than producing its own.

## Error codes

`ERROR_CODES` in `telemetry_packet.py` is part of the wire contract. Every
rejection carries a stable `code` alongside its human-readable message, so a
gateway or backend can branch on the reason without parsing prose. Message text
may change; codes may not, without a schema version bump.

Examples: `MISSING_REQUIRED_FIELD`, `UNKNOWN_FIELD`, `UNSUPPORTED_SCHEMA_VERSION`,
`INVALID_MEASUREMENT`, `SEQUENCE_NUMBER_OVERFLOW`, `NOT_VALID_JSON`.

## Reliability rules

1. A retry keeps the same `device_id` and `sequence_number`.
2. A new sample increments `sequence_number`.
3. The gateway deduplicates by `(device_id, sequence_number)`.
4. Critical packets are queued ahead of routine packets.
5. Unknown schema versions are rejected safely and logged as protocol errors.
6. Node timestamps are capture times; gateway timestamps are separate metadata.

## Security note

Phase 1 validates identity shape and sequencing only. Message authentication/encryption is deferred to the security phase and must not be implied by this schema.

A fixture that is *valid* means "well-formed and within the documented ranges". It
does not mean the packet is authentic, fresh, or clinically meaningful.

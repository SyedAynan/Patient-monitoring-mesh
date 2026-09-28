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

## Reliability rules

1. A retry keeps the same `device_id` and `sequence_number`.
2. A new sample increments `sequence_number`.
3. The gateway deduplicates by `(device_id, sequence_number)`.
4. Critical packets are queued ahead of routine packets.
5. Unknown schema versions are rejected safely and logged as protocol errors.
6. Node timestamps are capture times; gateway timestamps are separate metadata.

## Security note

Phase 1 validates identity shape and sequencing only. Message authentication/encryption is deferred to the security phase and must not be implied by this schema.

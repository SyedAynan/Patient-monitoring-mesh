"""Tests for the SQLite persistence layer.

Covers migration ordering and idempotence, the `(device_id, sequence_number)`
uniqueness constraint, query paths, and alert acknowledgement.
"""

from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.persistence import (  # noqa: E402
    MIGRATIONS,
    PersistedMeasurement,
    Persistence,
)


def sample_measurement(sequence_number: int = 1, **overrides) -> PersistedMeasurement:
    defaults = dict(
        device_id="node-01",
        patient_id="patient-01",
        sequence_number=sequence_number,
        captured_at_ms=1_798_000_000_000 + sequence_number * 1_000,
        received_at_ms=int(time.time() * 1000),
        heart_rate_bpm=72.0,
        spo2_percent=98.0,
        temperature_c=36.7,
        signal_quality=0.9,
        priority="routine",
        risk_level=None,
        risk_score=None,
    )
    defaults.update(overrides)
    return PersistedMeasurement(**defaults)


class MigrationTests(unittest.TestCase):
    def test_migrations_are_contiguous_from_one(self) -> None:
        versions = [version for version, _ in MIGRATIONS]
        self.assertEqual(versions, list(range(1, len(MIGRATIONS) + 1)))

    def test_migrations_apply_in_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = Persistence(Path(tmp) / "app.db")
            try:
                self.assertEqual(store.schema_version(), len(MIGRATIONS))
            finally:
                store.close()

    def test_migrations_are_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "app.db"
            store = Persistence(path)
            store.close()
            store = Persistence(path)  # reopen: nothing new to apply
            try:
                self.assertEqual(store.schema_version(), len(MIGRATIONS))
                self.assertEqual(store.measurement_count(), 0)
            finally:
                store.close()

    def test_persistence_creates_parent_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = Persistence(Path(tmp) / "nested" / "dir" / "app.db")
            try:
                self.assertTrue(store.db_path.parent.is_dir())
            finally:
                store.close()


class MeasurementTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.store = Persistence(Path(self._tmp.name) / "app.db")

    def tearDown(self) -> None:
        self.store.close()
        self._tmp.cleanup()

    def test_write_and_read_measurement(self) -> None:
        measurement = sample_measurement(risk_level="attention", risk_score=45.0)
        self.assertTrue(self.store.write_measurement(measurement))

        items = self.store.measurements_for("patient-01")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["device_id"], "node-01")
        self.assertEqual(items[0]["sequence_number"], 1)
        self.assertEqual(items[0]["risk"], {"level": "attention", "score": 45.0})

    def test_duplicate_key_is_rejected_by_the_database(self) -> None:
        """FR-05, enforced by the schema rather than by caller discipline."""
        self.assertTrue(self.store.write_measurement(sample_measurement(7)))
        self.assertFalse(self.store.write_measurement(sample_measurement(7)))
        self.assertEqual(self.store.measurement_count(), 1)

    def test_same_sequence_different_device_is_allowed(self) -> None:
        self.assertTrue(self.store.write_measurement(sample_measurement(1)))
        other = sample_measurement(1, device_id="node-02", patient_id="patient-02")
        self.assertTrue(self.store.write_measurement(other))
        self.assertEqual(self.store.measurement_count(), 2)

    def test_query_filters_and_ordering(self) -> None:
        for sequence_number in range(1, 11):
            self.store.write_measurement(sample_measurement(sequence_number))
        base = 1_798_000_000_000

        items = self.store.measurements_for("patient-01", from_ms=base + 5_000)
        self.assertEqual([i["sequence_number"] for i in items], [5, 6, 7, 8, 9, 10])

        windowed = self.store.measurements_for(
            "patient-01", from_ms=base + 3_000, to_ms=base + 6_000
        )
        self.assertEqual([i["sequence_number"] for i in windowed], [3, 4, 5, 6])

        limited = self.store.measurements_for("patient-01", limit=3)
        self.assertEqual([i["sequence_number"] for i in limited], [1, 2, 3])

    def test_unknown_patient_returns_empty(self) -> None:
        self.assertEqual(self.store.measurements_for("patient-99"), [])

    def test_latest_measurement_per_patient(self) -> None:
        for sequence_number in range(1, 4):
            self.store.write_measurement(sample_measurement(sequence_number))
        self.store.write_measurement(
            sample_measurement(1, device_id="node-02", patient_id="patient-02")
        )
        latest = self.store.latest_measurement_per_patient()
        self.assertEqual(set(latest), {"patient-01", "patient-02"})
        self.assertEqual(latest["patient-01"]["sequence_number"], 3)
        self.assertEqual(latest["patient-02"]["device_id"], "node-02")


class AlertAndEventTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.store = Persistence(Path(self._tmp.name) / "app.db")

    def tearDown(self) -> None:
        self.store.close()
        self._tmp.cleanup()

    def test_alert_write_and_acknowledge(self) -> None:
        alert = {
            "alert_id": "a-1",
            "severity": "critical",
            "device_id": "node-01",
            "patient_id": "patient-01",
            "message": "Heart rate elevated: 155 bpm",
            "raised_at_ms": 1_798_000_000_000,
        }
        self.store.write_alert(alert)

        acknowledged = self.store.acknowledge_alert("a-1", 1_798_000_100_000, "operator")
        self.assertTrue(acknowledged)

    def test_acknowledge_unknown_alert_fails_cleanly(self) -> None:
        self.assertFalse(self.store.acknowledge_alert("nope", 1, "operator"))

    def test_duplicate_alert_write_is_ignored(self) -> None:
        alert = {
            "alert_id": "a-1",
            "severity": "warning",
            "device_id": "node-01",
            "patient_id": "patient-01",
            "message": "SpO₂ low: 93%",
            "raised_at_ms": 1_798_000_000_000,
        }
        self.store.write_alert(alert)
        alert["message"] = "changed"
        self.store.write_alert(alert)
        # First write wins: alerts are immutable except acknowledgement.
        rows = self.store._conn.execute("SELECT message FROM alerts").fetchall()
        self.assertEqual([row["message"] for row in rows], ["SpO₂ low: 93%"])

    def test_event_write(self) -> None:
        event = {
            "event_id": "e-1",
            "type": "route_change",
            "device_id": "node-01",
            "at_ms": 1_798_000_000_000,
            "detail": "Rerouted to relay-02",
        }
        self.store.write_event(event)
        self.store.write_event(event)  # idempotent
        count = self.store._conn.execute("SELECT COUNT(*) AS n FROM network_events").fetchone()
        self.assertEqual(count["n"], 1)

    def test_device_upsert(self) -> None:
        self.store.upsert_device(
            device_id="node-01",
            patient_id="patient-01",
            role="node",
            status="online",
            last_seen_at_ms=1,
            signal_quality=0.9,
        )
        self.store.upsert_device(
            device_id="node-01",
            patient_id="patient-01",
            role="node",
            status="stale",
            last_seen_at_ms=2,
            signal_quality=0.5,
        )
        row = self.store._conn.execute("SELECT * FROM devices").fetchone()
        self.assertEqual(row["status"], "stale")
        self.assertEqual(row["last_seen_at_ms"], 2)


if __name__ == "__main__":
    unittest.main()
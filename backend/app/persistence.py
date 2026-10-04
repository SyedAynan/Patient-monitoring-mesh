"""SQLite persistence for measurements, alerts, events, and devices.

Phase 5 storage layer. Design points, all from the project rules:

- Migrations are numbered and versioned; every schema change adds one (Rules 8).
- `measurements` has a UNIQUE constraint on `(device_id, sequence_number)`:
  the protocol's dedup key, now enforced by the database itself (FR-05, NFR-04).
- Measurement writes use INSERT OR IGNORE, so a replayed or retransmitted packet
  is a no-op rather than a duplicate row.
- UTC epoch-ms integers everywhere; no local-time strings in storage.
- Connection handling is single-writer (the simulator loop) and read-only from
  routes, which is safe for SQLite's locking model at lab scale.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

# Each entry is (version, statement). Versions are contiguous; never edit an
# existing migration — append a new one.
MIGRATIONS: tuple[tuple[int, str], ...] = (
    (
        1,
        """
        CREATE TABLE IF NOT EXISTS measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            patient_id TEXT NOT NULL,
            sequence_number INTEGER NOT NULL,
            captured_at_ms INTEGER NOT NULL,
            received_at_ms INTEGER NOT NULL,
            heart_rate_bpm REAL NOT NULL,
            spo2_percent REAL NOT NULL,
            temperature_c REAL NOT NULL,
            signal_quality REAL NOT NULL,
            priority TEXT NOT NULL,
            risk_level TEXT,
            risk_score REAL,
            UNIQUE (device_id, sequence_number)
        );
        CREATE INDEX IF NOT EXISTS idx_measurements_patient_time
            ON measurements (patient_id, captured_at_ms);
        CREATE INDEX IF NOT EXISTS idx_measurements_device
            ON measurements (device_id, sequence_number);
        """,
    ),
    (
        2,
        """
        CREATE TABLE IF NOT EXISTS alerts (
            alert_id TEXT PRIMARY KEY,
            severity TEXT NOT NULL,
            device_id TEXT NOT NULL,
            patient_id TEXT NOT NULL,
            message TEXT NOT NULL,
            raised_at_ms INTEGER NOT NULL,
            acknowledged_at_ms INTEGER,
            acknowledged_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_raised
            ON alerts (raised_at_ms);
        """,
    ),
    (
        3,
        """
        CREATE TABLE IF NOT EXISTS network_events (
            event_id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            device_id TEXT NOT NULL,
            at_ms INTEGER NOT NULL,
            detail TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_time
            ON network_events (at_ms);
        """,
    ),
    (
        4,
        """
        CREATE TABLE IF NOT EXISTS devices (
            device_id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL,
            status TEXT NOT NULL,
            last_seen_at_ms INTEGER NOT NULL,
            signal_quality REAL NOT NULL
        );
        """,
    ),
    (
        5,
        """
        CREATE TABLE IF NOT EXISTS risk_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id TEXT NOT NULL,
            level TEXT NOT NULL,
            score INTEGER NOT NULL,
            signal_quality REAL NOT NULL,
            evidence TEXT NOT NULL,
            explanation TEXT NOT NULL DEFAULT '',
            config_fingerprint TEXT NOT NULL,
            captured_at_ms INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            sequence_number INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_risk_patient_time
            ON risk_snapshots (patient_id, captured_at_ms);
        """,
    ),
    (
        6,
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            event_id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            actor TEXT NOT NULL,
            target TEXT NOT NULL,
            outcome TEXT NOT NULL,
            at_ms INTEGER NOT NULL,
            detail TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_audit_time
            ON audit_events (at_ms);
        """,
    ),
)


@dataclass
class PersistedMeasurement:
    device_id: str
    patient_id: str
    sequence_number: int
    captured_at_ms: int
    received_at_ms: int
    heart_rate_bpm: float
    spo2_percent: float
    temperature_c: float
    signal_quality: float
    priority: str
    risk_level: str | None
    risk_score: float | None


class Persistence:
    """SQLite store. One instance per process; see module docstring for locking."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self.migrate()

    def close(self) -> None:
        self._conn.close()

    # -- schema -----------------------------------------------------------

    def migrate(self) -> None:
        """Apply every pending migration in order and stamp the schema version."""
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL)"
        )
        applied = {
            row["version"]
            for row in self._conn.execute("SELECT version FROM schema_migrations")
        }
        for version, statement in MIGRATIONS:
            if version in applied:
                continue
            with self._conn:
                self._conn.executescript(statement)
                self._conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at_ms) "
                    "VALUES (?, strftime('%s','now') * 1000)",
                    (version,),
                )

    def schema_version(self) -> int:
        row = self._conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
        return int(row["v"] or 0)

    # -- writes -----------------------------------------------------------

    def write_measurement(self, m: PersistedMeasurement) -> bool:
        """Insert one measurement. Returns False when it was already stored.

        The UNIQUE (device_id, sequence_number) constraint is the durable half of
        FR-05: even a buggy upstream path cannot create duplicate records.
        """
        with self._conn:
            cursor = self._conn.execute(
                """
                INSERT OR IGNORE INTO measurements (
                    device_id, patient_id, sequence_number, captured_at_ms,
                    received_at_ms, heart_rate_bpm, spo2_percent, temperature_c,
                    signal_quality, priority, risk_level, risk_score
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    m.device_id, m.patient_id, m.sequence_number, m.captured_at_ms,
                    m.received_at_ms, m.heart_rate_bpm, m.spo2_percent,
                    m.temperature_c, m.signal_quality, m.priority, m.risk_level,
                    m.risk_score,
                ),
            )
        return cursor.rowcount == 1

    def upsert_device(
        self,
        *,
        device_id: str,
        patient_id: str,
        role: str,
        status: str,
        last_seen_at_ms: int,
        signal_quality: float,
    ) -> None:
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO devices (device_id, patient_id, role, status,
                                     last_seen_at_ms, signal_quality)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    patient_id = excluded.patient_id,
                    status = excluded.status,
                    last_seen_at_ms = excluded.last_seen_at_ms,
                    signal_quality = excluded.signal_quality
                """,
                (device_id, patient_id, role, status, last_seen_at_ms, signal_quality),
            )

    def write_alert(self, a: dict[str, Any]) -> None:
        with self._conn:
            self._conn.execute(
                """
                INSERT OR IGNORE INTO alerts (
                    alert_id, severity, device_id, patient_id, message,
                    raised_at_ms, acknowledged_at_ms, acknowledged_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    a["alert_id"], a["severity"], a["device_id"], a["patient_id"],
                    a["message"], a["raised_at_ms"], a.get("acknowledged_at_ms"),
                    a.get("acknowledged_by"),
                ),
            )

    def acknowledge_alert(self, alert_id: str, at_ms: int, by: str) -> bool:
        with self._conn:
            cursor = self._conn.execute(
                "UPDATE alerts SET acknowledged_at_ms = ?, acknowledged_by = ? "
                "WHERE alert_id = ?",
                (at_ms, by, alert_id),
            )
        return cursor.rowcount == 1

    def write_event(self, e: dict[str, Any]) -> None:
        with self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO network_events "
                "(event_id, type, device_id, at_ms, detail) VALUES (?, ?, ?, ?, ?)",
                (e["event_id"], e["type"], e["device_id"], e["at_ms"], e["detail"]),
            )

    # -- reads ------------------------------------------------------------

    def write_risk_snapshot(self, snapshot: dict[str, Any]) -> None:
        """Store one risk assessment. Snapshots are append-only history."""
        import json

        with self._conn:
            self._conn.execute(
                """
                INSERT INTO risk_snapshots (
                    patient_id, level, score, signal_quality, evidence,
                    explanation, config_fingerprint, captured_at_ms, device_id,
                    sequence_number
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot["patient_id"],
                    snapshot["level"],
                    snapshot["score"],
                    snapshot["signal_quality"],
                    json.dumps(snapshot.get("evidence", []), sort_keys=True),
                    snapshot.get("explanation", ""),
                    snapshot["config_fingerprint"],
                    snapshot["captured_at_ms"],
                    snapshot.get("device_id", ""),
                    snapshot.get("sequence_number"),
                ),
            )

    def risk_snapshots_for(self, patient_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Latest-first risk history for one patient, evidence decoded."""
        import json

        rows = self._conn.execute(
            "SELECT * FROM risk_snapshots WHERE patient_id = ? "
            "ORDER BY captured_at_ms DESC, id DESC LIMIT ?",
            (patient_id, limit),
        )
        return [
            {
                "patient_id": row["patient_id"],
                "level": row["level"],
                "score": row["score"],
                "signal_quality": row["signal_quality"],
                "evidence": json.loads(row["evidence"]),
                "explanation": row["explanation"],
                "config_fingerprint": row["config_fingerprint"],
                "captured_at_ms": row["captured_at_ms"],
                "device_id": row["device_id"],
                "sequence_number": row["sequence_number"],
            }
            for row in rows
        ]

    def write_audit_event(self, event: dict[str, Any]) -> None:
        """Store one security-relevant action. Append-only."""
        with self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO audit_events "
                "(event_id, action, actor, target, outcome, at_ms, detail) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    event["event_id"], event["action"], event["actor"],
                    event["target"], event["outcome"], event["at_ms"],
                    event.get("detail", ""),
                ),
            )

    def audit_events_for(self, limit: int = 100) -> list[dict[str, Any]]:
        """Latest-first audit trail. `detail` must never hold a secret."""
        rows = self._conn.execute(
            "SELECT * FROM audit_events ORDER BY at_ms DESC, event_id LIMIT ?",
            (limit,),
        )
        return [
            {
                "event_id": row["event_id"],
                "action": row["action"],
                "actor": row["actor"],
                "target": row["target"],
                "outcome": row["outcome"],
                "at_ms": row["at_ms"],
                "detail": row["detail"],
            }
            for row in rows
        ]

    def measurement_count(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS n FROM measurements").fetchone()
        return int(row["n"])

    def measurements_for(
        self,
        patient_id: str,
        *,
        from_ms: int | None = None,
        to_ms: int | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        query = (
            "SELECT * FROM measurements WHERE patient_id = ?"
        )
        params: list[Any] = [patient_id]
        if from_ms is not None:
            query += " AND captured_at_ms >= ?"
            params.append(from_ms)
        if to_ms is not None:
            query += " AND captured_at_ms <= ?"
            params.append(to_ms)
        query += " ORDER BY captured_at_ms ASC, sequence_number ASC LIMIT ?"
        params.append(limit)
        return [_row_to_measurement(row) for row in self._conn.execute(query, params)]

    def latest_measurement_per_patient(self) -> dict[str, dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT m.* FROM measurements m
            JOIN (
                SELECT patient_id, MAX(captured_at_ms) AS max_ms
                FROM measurements GROUP BY patient_id
            ) latest ON m.patient_id = latest.patient_id
                    AND m.captured_at_ms = latest.max_ms
            """
        )
        return {row["patient_id"]: _row_to_measurement(row) for row in rows}


def _row_to_measurement(row: sqlite3.Row) -> dict[str, Any]:
    risk = None
    if row["risk_level"] is not None:
        risk = {"level": row["risk_level"], "score": row["risk_score"]}
    return {
        "device_id": row["device_id"],
        "patient_id": row["patient_id"],
        "sequence_number": row["sequence_number"],
        "captured_at_ms": row["captured_at_ms"],
        "heart_rate_bpm": row["heart_rate_bpm"],
        "spo2_percent": row["spo2_percent"],
        "temperature_c": row["temperature_c"],
        "signal_quality": row["signal_quality"],
        "priority": row["priority"],
        "risk": risk,
    }

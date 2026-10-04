"""Phase 5/6 contract tests for the FastAPI backend.

These pin the wire contract the dashboard depends on: envelope shape on every
REST route, measurement ordering, alert filtering and acknowledgement, network
metrics, risk explanation/config endpoints, and the realtime stream. The app
runs in-process with a fast tick interval so the simulator produces data within
the test.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.main import create_app  # noqa: E402
from backend.app.simulator_state import state  # noqa: E402
from backend.app.persistence import Persistence  # noqa: E402

# Real seconds to let the simulator produce data at the accelerated interval.
WARMUP_SECONDS = 1.5


def setUpModule() -> None:
    """Keep every test in this module off the real .data/ directory."""
    import os

    os.environ["REMPM_DISABLE_DB"] = "1"
    state.persistence = None


def tearDownModule() -> None:
    import os

    os.environ.pop("REMPM_DISABLE_DB", None)


class BackendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Speed the loop up so measurements exist within the test window.
        state._tick_interval = 0.02
        cls.app = create_app()
        cls.client = TestClient(cls.app)

    def setUp(self) -> None:
        pass

    def _get(self, path: str) -> dict:
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, path)
        return response.json()

    # -- envelope ----------------------------------------------------------

    def test_health_is_plain(self) -> None:
        with self.client:
            response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_every_api_route_returns_the_envelope(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and not state.measurements:
                time.sleep(0.05)
            for path in (
                "/api/v1/devices",
                "/api/v1/patients/patient-01/measurements",
                "/api/v1/alerts",
                "/api/v1/network/metrics",
            ):
                body = self._get(path)
                self.assertIn("data", body, path)
                self.assertIn("error", body, path)
                self.assertIsNone(body["error"], path)

    # -- devices ------------------------------------------------------------

    def test_devices_lists_all_mesh_roles(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and not state.measurements:
                time.sleep(0.05)
            body = self._get("/api/v1/devices")
        items = body["data"]["items"]
        roles = {item["role"] for item in items}
        self.assertEqual(roles, {"node", "relay", "gateway"})
        self.assertGreaterEqual(len(items), 8)  # 5 nodes + 2 relays + gateway
        for item in items:
            self.assertIn(item["status"], ("online", "stale", "offline"))

    # -- measurements -------------------------------------------------------

    def test_measurements_are_ascending_by_time(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and len(state.measurements) < 10:
                time.sleep(0.05)
            body = self._get("/api/v1/patients/patient-01/measurements?limit=100")
        items = body["data"]["items"]
        self.assertGreater(len(items), 0, "simulator produced no measurements")
        times = [item["captured_at_ms"] for item in items]
        self.assertEqual(times, sorted(times))
        for item in items:
            for key in (
                "device_id",
                "patient_id",
                "sequence_number",
                "captured_at_ms",
                "heart_rate_bpm",
                "spo2_percent",
                "temperature_c",
                "signal_quality",
                "priority",
            ):
                self.assertIn(key, item)

    def test_measurement_sequence_numbers_are_unique_per_device(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and len(state.measurements) < 10:
                time.sleep(0.05)
            body = self._get("/api/v1/patients/patient-01/measurements?limit=1000")
        pairs = [(item["device_id"], item["sequence_number"]) for item in body["data"]["items"]]
        self.assertEqual(len(pairs), len(set(pairs)), "duplicate (device, seq) records served")

    def test_measurements_time_window_is_respected(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and len(state.measurements) < 10:
                time.sleep(0.05)
            body = self._get("/api/v1/patients/patient-01/measurements?limit=1000")
        items = body["data"]["items"]
        if len(items) >= 2:
            midpoint = items[len(items) // 2]["captured_at_ms"]
            windowed = self._get(
                f"/api/v1/patients/patient-01/measurements?from_ms={midpoint}&limit=1000"
            )
            for item in windowed["data"]["items"]:
                self.assertGreaterEqual(item["captured_at_ms"], midpoint)

    def test_unknown_patient_returns_empty_items(self) -> None:
        with self.client:
            body = self._get("/api/v1/patients/patient-99/measurements")
        self.assertEqual(body["data"]["items"], [])

    # -- alerts --------------------------------------------------------------

    def test_alerts_filter_by_status(self) -> None:
        with self.client:
            # Force an alert by injecting a threshold-crossing measurement.
            asyncio.run(
                state._check_alerts(
                    _measurement(
                        device_id="node-01",
                        patient_id="patient-01",
                        heart_rate_bpm=155.0,
                    ),
                    int(time.time() * 1000),
                )
            )
            body = self._get("/api/v1/alerts?status=active")
            items = body["data"]["items"]
            self.assertGreater(len(items), 0)
            self.assertTrue(all(item["acknowledged_at_ms"] is None for item in items))

            acknowledged = self._get("/api/v1/alerts?status=acknowledged")
            self.assertTrue(
                all(item["acknowledged_at_ms"] is not None for item in acknowledged["data"]["items"])
            )

    def test_acknowledge_updates_the_alert(self) -> None:
        with self.client:
            asyncio.run(
                state._check_alerts(
                    _measurement(
                        device_id="node-02",
                        patient_id="patient-02",
                        spo2=85.0,
                    ),
                    int(time.time() * 1000),
                )
            )
            body = self._get("/api/v1/alerts?status=active")
            items = body["data"]["items"]
            self.assertGreater(len(items), 0)
            target = items[0]

            response = self.client.post(
                f"/api/v1/alerts/{target['alert_id']}/acknowledge"
            )
            self.assertEqual(response.status_code, 200)
            updated = response.json()["data"]
            self.assertIsNotNone(updated["acknowledged_at_ms"])
            self.assertEqual(updated["acknowledged_by"], "operator")

    def test_acknowledge_unknown_alert_is_404(self) -> None:
        with self.client:
            response = self.client.post("/api/v1/alerts/no-such-alert/acknowledge")
        self.assertEqual(response.status_code, 404)

    def test_invalid_status_filter_is_rejected(self) -> None:
        with self.client:
            response = self.client.get("/api/v1/alerts?status=banana")
        self.assertEqual(response.status_code, 422)

    # -- risk (Phase 6) ---------------------------------------------------

    def test_risk_config_get_returns_the_rule_set(self) -> None:
        with self.client:
            body = self._get("/api/v1/risk/config")
        data = body["data"]
        self.assertEqual(data["thresholds"]["hr_high"], 120.0)
        self.assertEqual(data["thresholds"]["spo2_low"], 94.0)
        self.assertIn("rules", data)
        self.assertIn("minimum_quality", data)
        self.assertIn("critical_score", data)

    def test_risk_config_put_updates_and_syncs_nodes(self) -> None:
        with self.client:
            response = self.client.put(
                "/api/v1/risk/config",
                json={"hr_high": 100, "hr_low": 55, "spo2_low": 95, "temp_high": 37.5},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["thresholds"]["hr_high"], 100)

        # Nodes in the running mesh now score with the same config: no drift.
        if state.mesh is not None:
            for node in state.mesh.nodes:
                self.assertEqual(node.config.risk_config.rules[0].bound, 100)

        # Restore defaults so other tests are unaffected.
        with self.client:
            restore = self.client.put(
                "/api/v1/risk/config",
                json={"hr_high": 120, "hr_low": 50, "spo2_low": 94, "temp_high": 38.0},
            )
        self.assertEqual(restore.status_code, 200)

    def test_risk_config_put_rejects_crossed_bounds(self) -> None:
        with self.client:
            response = self.client.put(
                "/api/v1/risk/config",
                json={"hr_high": 40, "hr_low": 60, "spo2_low": 94, "temp_high": 38.0},
            )
        self.assertEqual(response.status_code, 422)

    def test_patient_risk_returns_envelope_with_history(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and not state.measurements:
                time.sleep(0.05)
            # Force an assessment so a snapshot exists.
            asyncio.run(
                state._check_alerts(
                    _measurement(
                        device_id="node-01",
                        patient_id="patient-01",
                        heart_rate_bpm=155.0,
                    ),
                    int(time.time() * 1000),
                )
            )
            body = self._get("/api/v1/patients/patient-01/risk")
        data = body["data"]
        self.assertEqual(data["patient_id"], "patient-01")
        # Level may be critical or attention depending on accumulation; both
        # come from the engine, and the envelope shape is what is pinned here.
        self.assertIn(data["level"], ("normal", "attention", "critical", "unknown"))
        self.assertIn("latest_packet_risk", data)
        self.assertIn("history", data)

    def test_unknown_patient_risk_returns_nulls(self) -> None:
        with self.client:
            body = self._get("/api/v1/patients/patient-99/risk")
        data = body["data"]
        self.assertIsNone(data["level"])
        self.assertEqual(data["history"], [])

    def test_risk_snapshots_carry_evidence(self) -> None:
        """The Phase 6 DoD: every stored risk state is explainable."""
        with tempfile.TemporaryDirectory() as tmp:
            saved = state.persistence
            state.stop()  # detach any live store first
            state.persistence = Persistence(Path(tmp) / "app.db")
            state._owns_persistence = False
            try:
                # No stop() here: the pre-inject stop already ran, and another
                # one would close the store we just injected.
                state._tick_interval = 0.02
                state._last_risk_level.clear()
                app2 = create_app()
                client = TestClient(app2)
                with client:
                    asyncio.run(
                        state._check_alerts(
                            _measurement(
                                device_id="node-03",
                                patient_id="patient-03",
                                spo2=85.0,
                            ),
                            int(time.time() * 1000),
                        )
                    )
                    body = client.get("/api/v1/patients/patient-03/risk")
                snapshots = body.json()["data"]["history"]
                self.assertGreater(len(snapshots), 0)
                for snapshot in snapshots:
                    self.assertIn("evidence", snapshot)
                    self.assertIn("explanation", snapshot)
                    self.assertIn("config_fingerprint", snapshot)
                    for entry in snapshot["evidence"]:
                        self.assertIn("rule", entry)
                        self.assertIn("value", entry)
                        self.assertIn("bound", entry)
            finally:
                state.stop()
                state.persistence = saved

    # -- network metrics -------------------------------------------------------

    def test_network_metrics_shape(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and not state.measurements:
                time.sleep(0.05)
            body = self._get("/api/v1/network/metrics")
        data = body["data"]
        for key in (
            "nodes_total",
            "nodes_online",
            "delivery_ratio",
            "alert_latency_ms_p50",
            "recent_events",
        ):
            self.assertIn(key, data)
        self.assertGreater(data["nodes_total"], 0)
        self.assertLessEqual(data["nodes_online"], data["nodes_total"])

    # -- realtime ---------------------------------------------------------------

    def test_realtime_stream_pushes_measurements(self) -> None:
        with self.client:
            deadline = time.monotonic() + WARMUP_SECONDS
            while time.monotonic() < deadline and not state.measurements:
                time.sleep(0.05)
            with self.client.websocket_connect("/api/v1/realtime") as ws:
                # The simulator keeps ticking at the accelerated interval, so a
                # broadcast arrives within a few test-loop ticks.
                message = json.loads(ws.receive_text())
        self.assertIn(message["type"], ("measurement", "alert", "device_status", "network_event"))
        self.assertIn("payload", message)
        if message["type"] == "measurement":
            for key in ("device_id", "heart_rate_bpm", "captured_at_ms"):
                self.assertIn(key, message["payload"])


class PersistenceIntegrationTests(unittest.TestCase):
    """The full stack with SQLite: history served from the database.

    Routes read the module singleton, so these tests swap the singleton's
    persistence for a temp database and restore it afterwards.
    """

    def test_history_is_served_from_the_database(self) -> None:
        import tempfile
        from pathlib import Path

        saved = state.persistence
        with tempfile.TemporaryDirectory() as tmp:
            state.stop()
            p = Persistence(Path(tmp) / "app.db")
            state.persistence = p
            try:
                state._tick_interval = 0.02
                app2 = create_app()
                client = TestClient(app2)
                with client:
                    deadline = time.monotonic() + 3.0
                    while time.monotonic() < deadline and len(state.measurements) < 5:
                        time.sleep(0.05)
                    body = client.get(
                        "/api/v1/patients/patient-01/measurements?limit=1000"
                    )
                    self.assertEqual(body.status_code, 200)
                    items = body.json()["data"]["items"]
                    self.assertGreaterEqual(len(items), 1)
                    # Rows exist in the DB for everything served and then some.
                    # Must read before the client context exits, because the
                    # lifespan shutdown calls state.stop() which closes the DB.
                    count = state.persistence.measurement_count()
                    self.assertGreaterEqual(count, len(items))
            finally:
                state.stop()
                state.persistence = saved

    def test_disabled_persistence_keeps_the_in_memory_fallback(self) -> None:
        saved = state.persistence
        state.persistence = None
        try:
            state.stop()
            state._tick_interval = 0.02
            app2 = create_app()
            client = TestClient(app2)
            with client:
                body = client.get("/api/v1/patients/patient-01/measurements")
            self.assertEqual(body.status_code, 200)
            self.assertIn("items", body.json()["data"])
        finally:
            state.stop()
            state.persistence = saved


def _measurement(
    *,
    device_id: str,
    patient_id: str,
    heart_rate_bpm: float = 72.0,
    spo2: float = 98.0,
    temperature: float = 36.7,
) -> object:
    """Build a MeasurementRecord-shaped object for alert-threshold tests."""
    from backend.app.simulator_state import MeasurementRecord

    return MeasurementRecord(
        device_id=device_id,
        patient_id=patient_id,
        sequence_number=1,
        captured_at_ms=int(time.time() * 1000),
        heart_rate_bpm=heart_rate_bpm,
        spo2_percent=spo2,
        temperature_c=temperature,
        signal_quality=0.9,
        priority="routine",
    )


if __name__ == "__main__":
    unittest.main()
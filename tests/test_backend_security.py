"""Phase 7 backend tests: operator auth, audit trail, device revocation.

Runs in lab mode (default) and flips to token mode via environment to prove
fail-closed behaviour: wrong/missing token refuses mutations, an unconfigured
token mode refuses everything, and every decision lands in the audit trail.
"""

from __future__ import annotations

import asyncio
import os
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


def _clear_env() -> None:
    for key in ("BACKEND_AUTH_MODE", "OPERATOR_TOKEN"):
        os.environ.pop(key, None)


class OperatorAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_env()
        state.stop()
        state.persistence = None
        state._tick_interval = 0.02

    def tearDown(self) -> None:
        _clear_env()

    def _client(self) -> TestClient:
        return TestClient(create_app())

    def _force_alert(self, device_id: str = "node-01") -> str:
        from tests.test_backend_api import _measurement

        asyncio.run(
            state._check_alerts(
                _measurement(
                    device_id=device_id,
                    patient_id=f"patient-{device_id[-2:]}",
                    heart_rate_bpm=155.0,
                ),
                int(time.time() * 1000),
            )
        )
        active = [a for a in state.alerts.values() if a.acknowledged_at_ms is None]
        self.assertTrue(active)
        return active[0].alert_id

    def test_lab_mode_allows_mutation_without_token(self) -> None:
        client = self._client()
        with client:
            alert_id = self._force_alert()
            response = client.post(f"/api/v1/alerts/{alert_id}/acknowledge")
        self.assertEqual(response.status_code, 200)

    def test_token_mode_refuses_without_token(self) -> None:
        os.environ["BACKEND_AUTH_MODE"] = "token"
        os.environ["OPERATOR_TOKEN"] = "secret-op-token"
        client = self._client()
        with client:
            alert_id = self._force_alert()
            response = client.post(f"/api/v1/alerts/{alert_id}/acknowledge")
        self.assertEqual(response.status_code, 401)

    def test_token_mode_refuses_wrong_token(self) -> None:
        os.environ["BACKEND_AUTH_MODE"] = "token"
        os.environ["OPERATOR_TOKEN"] = "secret-op-token"
        client = self._client()
        with client:
            alert_id = self._force_alert()
            response = client.post(
                f"/api/v1/alerts/{alert_id}/acknowledge",
                headers={"X-Operator-Token": "wrong"},
            )
        self.assertEqual(response.status_code, 401)

    def test_token_mode_accepts_correct_token(self) -> None:
        os.environ["BACKEND_AUTH_MODE"] = "token"
        os.environ["OPERATOR_TOKEN"] = "secret-op-token"
        client = self._client()
        with client:
            alert_id = self._force_alert()
            response = client.post(
                f"/api/v1/alerts/{alert_id}/acknowledge",
                headers={"X-Operator-Token": "secret-op-token"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"]["acknowledged_at_ms"])

    def test_unconfigured_token_mode_refuses_everything(self) -> None:
        """Fail closed: token mode with no OPERATOR_TOKEN set refuses all."""
        os.environ["BACKEND_AUTH_MODE"] = "token"
        client = self._client()
        with client:
            alert_id = self._force_alert()
            response = client.post(
                f"/api/v1/alerts/{alert_id}/acknowledge",
                headers={"X-Operator-Token": "anything"},
            )
        self.assertEqual(response.status_code, 401)

    def test_reads_are_open_in_token_mode(self) -> None:
        os.environ["BACKEND_AUTH_MODE"] = "token"
        os.environ["OPERATOR_TOKEN"] = "secret-op-token"
        client = self._client()
        with client:
            for path in ("/api/v1/devices", "/api/v1/alerts", "/api/v1/risk/config"):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, path)

    def test_unknown_auth_mode_fails_closed_to_token(self) -> None:
        from backend.app.security import current_auth_mode

        os.environ["BACKEND_AUTH_MODE"] = "banana"
        try:
            self.assertEqual(current_auth_mode(), "token")
        finally:
            os.environ.pop("BACKEND_AUTH_MODE", None)

    def test_health_reports_auth_mode_without_the_token(self) -> None:
        os.environ["BACKEND_AUTH_MODE"] = "token"
        os.environ["OPERATOR_TOKEN"] = "secret-op-token"
        client = self._client()
        with client:
            body = client.get("/health").json()
        self.assertEqual(body["auth_mode"], "token")
        self.assertNotIn("secret-op-token", str(body))


class AuditTrailTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_env()
        state.stop()
        state.persistence = None
        state._tick_interval = 0.02

    def tearDown(self) -> None:
        _clear_env()
        state.stop()
        state.persistence = None

    def test_acknowledge_writes_an_audit_event(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state.persistence = Persistence(Path(tmp) / "app.db")
            state._owns_persistence = False
            try:
                client = TestClient(create_app())
                with client:
                    from tests.test_backend_api import _measurement

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
                    alert_id = [
                        a for a in state.alerts.values() if a.acknowledged_at_ms is None
                    ][0].alert_id
                    response = client.post(f"/api/v1/alerts/{alert_id}/acknowledge")
                    self.assertEqual(response.status_code, 200)
                    # Read before the context exits: shutdown calls state.stop(),
                    # which closes and detaches the injected persistence.
                    events = state.persistence.audit_events_for()
                    self.assertGreaterEqual(len(events), 1)
                    ack_events = [e for e in events if e["action"] == "alert_acknowledge"]
                    self.assertEqual(len(ack_events), 1)
                    self.assertEqual(ack_events[0]["outcome"], "OK")
                    self.assertEqual(ack_events[0]["target"], alert_id)
            finally:
                state.stop()
                state.persistence = None

    def test_refused_mutation_is_audited(self) -> None:
        os.environ["BACKEND_AUTH_MODE"] = "token"
        os.environ["OPERATOR_TOKEN"] = "secret-op-token"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                state.persistence = Persistence(Path(tmp) / "app.db")
                state._owns_persistence = False
                try:
                    client = TestClient(create_app())
                    with client:
                        from tests.test_backend_api import _measurement

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
                        alert_id = [
                            a for a in state.alerts.values()
                            if a.acknowledged_at_ms is None
                        ][0].alert_id
                        response = client.post(f"/api/v1/alerts/{alert_id}/acknowledge")
                        self.assertEqual(response.status_code, 401)
                        # Read before the context exits (shutdown closes the DB).
                        events = state.persistence.audit_events_for()
                        refused = [
                            e for e in events
                            if e["action"] == "alert_acknowledge" and e["outcome"] != "OK"
                        ]
                        self.assertEqual(len(refused), 1)
                        self.assertNotIn("secret-op-token", str(events))
                finally:
                    state.stop()
                    state.persistence = None
        finally:
            _clear_env()


class DeviceRevocationTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_env()
        os.environ["MESH_AUTH"] = "1"
        state.stop()
        state.persistence = None
        state._tick_interval = 0.02

    def tearDown(self) -> None:
        _clear_env()
        os.environ.pop("MESH_AUTH", None)
        state.stop()
        state.persistence = None

    def test_revoke_requires_authentication_to_be_enabled(self) -> None:
        os.environ.pop("MESH_AUTH", None)
        client = TestClient(create_app())
        with client:
            response = client.post("/api/v1/devices/node-01/revoke")
        self.assertEqual(response.status_code, 409)

    def test_revoke_unknown_device_is_404(self) -> None:
        client = TestClient(create_app())
        with client:
            response = client.post("/api/v1/devices/node-99/revoke")
        self.assertEqual(response.status_code, 404)

    def test_revoke_cuts_the_device_off_and_audits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state.persistence = Persistence(Path(tmp) / "app.db")
            state._owns_persistence = False
            try:
                client = TestClient(create_app())
                with client:
                    # Wait for some authenticated traffic first.
                    deadline = time.monotonic() + 3.0
                    while time.monotonic() < deadline and not state.measurements:
                        time.sleep(0.05)
                    self.assertEqual(state.mesh.gateway.stats.auth_rejected, 0)

                    response = client.post("/api/v1/devices/node-02/revoke")
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.json()["data"]["revoked"])

                    # Subsequent traffic from node-02 is refused.
                    deadline = time.monotonic() + 2.0
                    while (
                        time.monotonic() < deadline
                        and state.mesh.gateway.stats.auth_revoked == 0
                    ):
                        time.sleep(0.05)
                    self.assertGreater(state.mesh.gateway.stats.auth_revoked, 0)

                    events = state.persistence.audit_events_for()
                    revoke_events = [e for e in events if e["action"] == "device_revoke"]
                    self.assertEqual(len(revoke_events), 1)
                    self.assertEqual(revoke_events[0]["outcome"], "OK")
            finally:
                state.stop()
                state.persistence = None

    def test_mesh_auth_env_gives_an_authenticated_backend(self) -> None:
        client = TestClient(create_app())
        with client:
            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline and not state.measurements:
                time.sleep(0.05)
        self.assertIsNotNone(state.mesh.gateway.credential_store)
        self.assertGreater(state.mesh.gateway.stats.packets_accepted, 0)
        self.assertEqual(state.mesh.gateway.stats.auth_rejected, 0)


if __name__ == "__main__":
    unittest.main()
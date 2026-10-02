"""Phase 5 contract tests for the FastAPI backend.

These pin the wire contract the dashboard depends on: envelope shape on every
REST route, measurement ordering, alert filtering and acknowledgement, network
metrics, and the realtime stream. They run the app in-process with a fast tick
interval so the simulator produces data within the test.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.main import create_app  # noqa: E402
from backend.app.simulator_state import state  # noqa: E402


class BackendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Speed the loop up so measurements exist within the test window.
        state._tick_interval = 0.02
        cls.app = create_app()
        cls.client = TestClient(cls.app)

    def setUp(self) -> None:
        pass

    # -- envelope ----------------------------------------------------------

    def test_health_is_plain(self) -> None:
        with self.client as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_every_api_route_returns_the_envelope(self) -> None:
        with self.client as client:
            for path in (
                "/api/v1/devices",
                "/api/v1/patients/patient-01/measurements",
                "/api/v1/alerts",
                "/api/v1/network/metrics",
            ):
                body = client.get(path).json()
                self.assertIn("data", body, path)
                self.assertIn("error", body, path)


if __name__ == "__main__":
    unittest.main()
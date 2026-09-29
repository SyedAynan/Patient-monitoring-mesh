"""Conformance tests driven by the committed fixture corpus.

Any implementation of TelemetryPacketV1 -- firmware, gateway, or backend -- is
conformant when it accepts every valid fixture, re-encodes it to identical bytes,
and rejects every invalid fixture with the manifest's error code. These tests are
that check for the Python validator and are the reference behavior for the others.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.protocol import (  # noqa: E402
    ERROR_CODES,
    SCHEMA_VERSION,
    PacketValidationError,
    decode_packet,
    encode_packet,
    validate_packet,
)

FIXTURE_DIR = ROOT / "shared" / "protocol" / "fixtures"


def load_manifest() -> dict:
    return json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))


class ProtocolFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = load_manifest()
        cls.valid = [
            entry for entry in cls.manifest["fixtures"] if entry["expect"] == "valid"
        ]
        cls.invalid = [
            entry for entry in cls.manifest["fixtures"] if entry["expect"] == "invalid"
        ]

    def test_manifest_covers_both_directions(self) -> None:
        self.assertGreaterEqual(len(self.valid), 5)
        self.assertGreaterEqual(len(self.invalid), 15)

    def test_manifest_is_consistent(self) -> None:
        self.assertEqual(self.manifest["schema_version"], SCHEMA_VERSION)
        for entry in self.manifest["fixtures"]:
            self.assertTrue((FIXTURE_DIR / entry["file"]).is_file(), entry["file"])
            if entry["expect"] == "invalid":
                self.assertIn(entry["error_code"], ERROR_CODES, entry["name"])

    def test_valid_fixtures_decode_and_round_trip_exactly(self) -> None:
        for entry in self.valid:
            raw = (FIXTURE_DIR / entry["file"]).read_bytes()
            with self.subTest(fixture=entry["name"]):
                packet = decode_packet(raw)
                # Byte-exact: the canonical encoding is part of the contract, so
                # every implementation must produce these same bytes.
                self.assertEqual(encode_packet(packet), raw)

    def test_valid_fixtures_keep_their_identity_and_sequence(self) -> None:
        for entry in self.valid:
            raw = (FIXTURE_DIR / entry["file"]).read_bytes()
            packet = decode_packet(raw)
            with self.subTest(fixture=entry["name"]):
                self.assertEqual(packet["schema_version"], SCHEMA_VERSION)
                self.assertIsInstance(packet["device_id"], str)
                self.assertIsInstance(packet["sequence_number"], int)

    def test_invalid_fixtures_are_rejected_with_the_manifest_code(self) -> None:
        for entry in self.invalid:
            raw = (FIXTURE_DIR / entry["file"]).read_bytes()
            with self.subTest(fixture=entry["name"]):
                with self.assertRaises(PacketValidationError) as caught:
                    decode_packet(raw)
                self.assertEqual(caught.exception.code, entry["error_code"])

    def test_invalid_fixtures_never_raise_anything_else(self) -> None:
        for entry in self.invalid:
            raw = (FIXTURE_DIR / entry["file"]).read_bytes()
            with self.subTest(fixture=entry["name"]):
                try:
                    decode_packet(raw)
                except PacketValidationError:
                    pass
                except Exception as exc:  # noqa: BLE001 - the point of the test
                    self.fail(f"{entry['name']} raised {type(exc).__name__}: {exc}")

    def test_error_codes_are_stable_strings(self) -> None:
        for code in ERROR_CODES:
            self.assertRegex(code, r"^[A-Z][A-Z0-9_]*$")

    def test_validation_error_exposes_a_code(self) -> None:
        with self.assertRaises(PacketValidationError) as caught:
            validate_packet({"schema_version": 1})
        self.assertEqual(caught.exception.code, "MISSING_REQUIRED_FIELD")


if __name__ == "__main__":
    unittest.main()
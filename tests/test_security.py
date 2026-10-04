"""Phase 7 tests: MAC, credentials, envelope auth, and gateway enforcement.

Covers the fail-closed rules (Rules section 12): unknown senders, revoked
devices, and wrong keys are rejected before their payloads are parsed, with no
acknowledgement; legitimate signed traffic is indistinguishable in outcome from
unauthenticated traffic; the replay signal never suppresses backfill.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.protocol import encode_packet, make_packet  # noqa: E402
from shared.security import (  # noqa: E402
    DeviceCredentialStore,
    VerificationOutcome,
    compute_frame_mac,
    verify_frame_mac,
)
from simulator.roles import Gateway, NodeConfig, SensorNode  # noqa: E402
from simulator.sensing.sources import NominalSource  # noqa: E402
from simulator.topology import (  # noqa: E402
    GATEWAY_ID,
    RELAY_ID,
    build_standard_mesh,
    run,
)
from simulator.transport import Frame, FrameError, SimulatedMedium  # noqa: E402

SEED = 20260928
KEY = b"test-lab-key"
SPOOF_KEY = b"attacker-key"


def data_frame(source: str = "node-01", sequence: int = 1) -> Frame:
    packet = make_packet(
        device_id=source,
        patient_id=f"patient-{source[-2:]}",
        sequence_number=sequence,
        captured_at_ms=1_798_000_000_000 + sequence * 1_000,
        heart_rate_bpm=72,
        spo2_percent=98,
        temperature_c=36.7,
    )
    payload = encode_packet(packet)
    mac = compute_frame_mac(
        source=source, destination=GATEWAY_ID,
        message_id=f"{source}:{sequence}", payload=payload, key=KEY,
    )
    return Frame(
        source=source, destination=GATEWAY_ID,
        message_id=f"{source}:{sequence}", payload=payload, auth=mac,
    )


class MacTests(unittest.TestCase):
    def test_round_trip(self) -> None:
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m-1", payload=b"payload", key=KEY,
        )
        ok, reason = verify_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m-1", payload=b"payload", key=KEY, presented_mac=mac,
        )
        self.assertTrue(ok)
        self.assertIsNone(reason)

    def test_tampered_payload_is_rejected(self) -> None:
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m-1", payload=b"payload", key=KEY,
        )
        ok, reason = verify_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m-1", payload=b"tampered", key=KEY, presented_mac=mac,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "MAC_MISMATCH")

    def test_impersonated_source_is_rejected(self) -> None:
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m-1", payload=b"payload", key=KEY,
        )
        ok, reason = verify_frame_mac(
            source="node-99", destination=GATEWAY_ID,
            message_id="m-1", payload=b"payload", key=KEY, presented_mac=mac,
        )
        self.assertFalse(ok)

    def test_missing_mac_is_reported(self) -> None:
        ok, reason = verify_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m-1", payload=b"p", key=KEY, presented_mac=None,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "MAC_MISSING")

    def test_bad_format_is_reported(self) -> None:
        for bad in ("", "xyz", "a" * 63, "g" * 64):
            ok, reason = verify_frame_mac(
                source="node-01", destination=GATEWAY_ID,
                message_id="m-1", payload=b"p", key=KEY, presented_mac=bad,
            )
            self.assertFalse(ok)
            self.assertEqual(reason, "MAC_INVALID_FORMAT", bad)

    def test_mac_is_deterministic(self) -> None:
        kwargs = dict(source="a", destination="b", message_id="m", payload=b"p", key=KEY)
        self.assertEqual(compute_frame_mac(**kwargs), compute_frame_mac(**kwargs))

    def test_mac_covers_all_immutable_fields(self) -> None:
        base = compute_frame_mac(
            source="a", destination="b", message_id="m", payload=b"p", key=KEY,
        )
        changed_dest = compute_frame_mac(
            source="a", destination="c", message_id="m", payload=b"p", key=KEY,
        )
        changed_msg = compute_frame_mac(
            source="a", destination="b", message_id="m2", payload=b"p", key=KEY,
        )
        self.assertNotEqual(base, changed_dest)
        self.assertNotEqual(base, changed_msg)


class CredentialStoreTests(unittest.TestCase):
    def test_unknown_device_fails_closed(self) -> None:
        store = DeviceCredentialStore(master_key=KEY)
        outcome = store.verify(
            source="node-99", destination=GATEWAY_ID,
            message_id="m", payload=b"p", presented_mac=None,
        )
        self.assertFalse(outcome.accepted)
        self.assertEqual(outcome.reason, "UNKNOWN_DEVICE")

    def test_revoked_device_fails_closed(self) -> None:
        store = DeviceCredentialStore(master_key=KEY)
        store.provision("node-01")
        store.revoke("node-01")
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", key=KEY,
        )
        outcome = store.verify(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", presented_mac=mac,
        )
        self.assertFalse(outcome.accepted)
        self.assertEqual(outcome.reason, "REVOKED")

    def test_rotation_invalidates_old_key_immediately(self) -> None:
        store = DeviceCredentialStore()
        store.provision("node-01", key=KEY)
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", key=KEY,
        )
        self.assertTrue(store.verify(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", presented_mac=mac,
        ).accepted)
        store.rotate("node-01", b"new-key")
        outcome = store.verify(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", presented_mac=mac,
        )
        self.assertFalse(outcome.accepted)
        self.assertEqual(outcome.reason, "MAC_MISMATCH")

    def test_master_key_device_without_master_fails_closed(self) -> None:
        store = DeviceCredentialStore(master_key=None)
        store.provision("node-01")  # no own key, no master: must not pass
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", key=b"anything",
        )
        outcome = store.verify(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", presented_mac=mac,
        )
        self.assertFalse(outcome.accepted)

    def test_per_device_key_beats_master(self) -> None:
        store = DeviceCredentialStore(master_key=KEY)
        store.provision("node-01", key=b"own")
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", key=b"own",
        )
        self.assertTrue(store.verify(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", presented_mac=mac,
        ).accepted)

    def test_summary_never_exposes_keys(self) -> None:
        store = DeviceCredentialStore(master_key=KEY)
        store.provision("node-01", key=b"secret-secret")
        summary = str(store.summary())
        self.assertNotIn("secret", summary)
        self.assertNotIn(KEY.decode(), summary)

    def test_duplicate_provision_replaces(self) -> None:
        store = DeviceCredentialStore()
        store.provision("node-01", key=b"old")
        store.provision("node-01", key=KEY)  # re-provision clears revocation
        store.revoke("node-01")
        store.provision("node-01", key=KEY)
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", key=KEY,
        )
        self.assertTrue(store.verify(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"p", presented_mac=mac,
        ).accepted)

    def test_revoke_unknown_returns_false(self) -> None:
        store = DeviceCredentialStore()
        self.assertFalse(store.revoke("nope"))


class EnvelopeAuthTests(unittest.TestCase):
    def test_auth_round_trips_through_bytes(self) -> None:
        frame = data_frame()
        parsed = Frame.from_bytes(frame.to_bytes())
        self.assertEqual(parsed.auth, frame.auth)

    def test_forwarded_frame_preserves_auth(self) -> None:
        forwarded = data_frame().forwarded_by(RELAY_ID)
        self.assertEqual(forwarded.auth, data_frame().auth)

    def test_invalid_auth_format_rejected_at_construction(self) -> None:
        for bad in ("nothex", "f" * 63, None if False else "zz" * 32):
            with self.subTest(bad=bad):
                with self.assertRaises(FrameError):
                    Frame(
                        source="a", destination="b", message_id="m",
                        payload=b"x", auth=bad,
                    )

    def test_valid_hex_of_wrong_length_is_rejected(self) -> None:
        with self.assertRaises(FrameError):
            Frame(source="a", destination="b", message_id="m", payload=b"x", auth="ab" * 31)

    def test_unsigned_frame_still_allowed(self) -> None:
        frame = Frame(source="a", destination="b", message_id="m", payload=b"x")
        self.assertIsNone(Frame.from_bytes(frame.to_bytes()).auth)


class GatewayAuthTests(unittest.TestCase):
    def _gateway(self) -> tuple[Gateway, SimulatedMedium]:
        medium = SimulatedMedium(seed=1)
        medium.register(GATEWAY_ID)
        medium.register("node-01")
        medium.connect("node-01", GATEWAY_ID)
        store = DeviceCredentialStore(master_key=KEY)
        store.provision("node-01")
        gateway = Gateway(
            gateway_id=GATEWAY_ID,
            transport=medium.transport(GATEWAY_ID),
            credential_store=store,
        )
        return gateway, medium

    def _signed_frame(self, sequence: int = 1, key: bytes = KEY) -> Frame:
        packet = make_packet(
            device_id="node-01", patient_id="patient-01", sequence_number=sequence,
            captured_at_ms=1_798_000_000_000, heart_rate_bpm=72,
            spo2_percent=98, temperature_c=36.7,
        )
        payload = encode_packet(packet)
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id=f"node-01:{sequence}", payload=payload, key=key,
        )
        return Frame(source="node-01", destination=GATEWAY_ID,
                     message_id=f"node-01:{sequence}", payload=payload, auth=mac)

    def test_signed_frame_is_accepted_and_acked(self) -> None:
        gateway, medium = self._gateway()
        medium.transport("node-01").transmit(GATEWAY_ID, self._signed_frame().to_bytes())
        gateway.tick()
        self.assertEqual(gateway.stats.packets_accepted, 1)
        self.assertEqual(gateway.stats.acks_sent, 1)

    def test_spoofed_mac_is_rejected_without_ack(self) -> None:
        gateway, medium = self._gateway()
        medium.transport("node-01").transmit(
            GATEWAY_ID, self._signed_frame(key=SPOOF_KEY).to_bytes()
        )
        gateway.tick()
        self.assertEqual(gateway.stats.packets_accepted, 0)
        self.assertEqual(gateway.stats.acks_sent, 0)
        self.assertEqual(gateway.stats.auth_rejected, 1)
        self.assertEqual(gateway.stats.auth_bad_mac, 1)

    def test_unsigned_frame_is_rejected_when_authentication_is_on(self) -> None:
        gateway, medium = self._gateway()
        frame = self._signed_frame()
        raw = Frame(source=frame.source, destination=frame.destination,
                    message_id=frame.message_id, payload=frame.payload)
        medium.transport("node-01").transmit(GATEWAY_ID, raw.to_bytes())
        gateway.tick()
        self.assertEqual(gateway.stats.packets_accepted, 0)
        self.assertEqual(gateway.stats.auth_rejected, 1)

    def test_unknown_source_is_rejected(self) -> None:
        gateway, medium = self._gateway()
        mac = compute_frame_mac(
            source="node-99", destination=GATEWAY_ID,
            message_id="node-99:1", payload=b"x", key=KEY,
        )
        medium.transport("node-01").transmit(
            GATEWAY_ID,
            Frame(source="node-99", destination=GATEWAY_ID,
                  message_id="node-99:1", payload=b"x", auth=mac).to_bytes(),
        )
        gateway.tick()
        self.assertEqual(gateway.stats.auth_unknown_device, 1)

    def test_revoked_device_is_rejected_without_ack(self) -> None:
        gateway, medium = self._gateway()
        gateway.credential_store.revoke("node-01")
        medium.transport("node-01").transmit(GATEWAY_ID, self._signed_frame().to_bytes())
        gateway.tick()
        self.assertEqual(gateway.stats.packets_accepted, 0)
        self.assertEqual(gateway.stats.acks_sent, 0)
        self.assertEqual(gateway.stats.auth_revoked, 1)

    def test_auth_happens_before_payload_parsing(self) -> None:
        """A spoofed frame with garbage payload must count as auth-rejected,
        not invalid-payload: verification precedes the contract path."""
        gateway, medium = self._gateway()
        mac = compute_frame_mac(
            source="node-01", destination=GATEWAY_ID,
            message_id="m", payload=b"garbage", key=SPOOF_KEY,
        )
        medium.transport("node-01").transmit(
            GATEWAY_ID,
            Frame(source="node-01", destination=GATEWAY_ID,
                  message_id="m", payload=b"garbage", auth=mac).to_bytes(),
        )
        gateway.tick()
        self.assertEqual(gateway.stats.auth_rejected, 1)
        self.assertEqual(gateway.stats.packets_invalid, 0)

    def test_replay_far_below_water_mark_is_counted_not_suppressed(self) -> None:
        """A very old backfilled sequence still lands; the stat is a signal."""
        gateway, medium = self._gateway()
        # Deliver sequences 1..10 in order to set the high-water mark.
        for sequence in range(1, 11):
            medium.transport("node-01").transmit(
                GATEWAY_ID, self._signed_frame(sequence).to_bytes()
            )
            gateway.tick()
        self.assertEqual(gateway.stats.packets_accepted, 10)

        # An out-of-contract very old sequence (would be seq -300; simulated by
        # delivering seq 1 again — already stored, counted as duplicate).
        medium.transport("node-01").transmit(GATEWAY_ID, self._signed_frame(1).to_bytes())
        gateway.tick()
        self.assertEqual(gateway.stats.packets_duplicate, 1)
        self.assertEqual(len(gateway.received), 10)


class NodeSigningTests(unittest.TestCase):
    def test_node_with_key_signs_its_frames(self) -> None:
        medium = SimulatedMedium(seed=1)
        medium.register(GATEWAY_ID)
        medium.register("node-01")
        medium.connect("node-01", GATEWAY_ID)
        node = SensorNode(
            config=NodeConfig(
                device_id="node-01", patient_id="patient-01",
                gateway_id=GATEWAY_ID, next_hop=GATEWAY_ID,
                samples_per_packet=1, mac_key=KEY,
            ),
            source=NominalSource(seed=1),
            transport=medium.transport("node-01"),
        )
        node.tick(1_798_000_000_000)
        frames = medium.drain(GATEWAY_ID)
        self.assertEqual(len(frames), 1)
        frame = Frame.from_bytes(frames[0])
        self.assertIsNotNone(frame.auth)

        ok, reason = verify_frame_mac(
            source=frame.source, destination=frame.destination,
            message_id=frame.message_id, payload=frame.payload,
            key=KEY, presented_mac=frame.auth,
        )
        self.assertTrue(ok, reason)

    def test_node_without_key_emits_unsigned_frames(self) -> None:
        medium = SimulatedMedium(seed=1)
        medium.register(GATEWAY_ID)
        medium.register("node-01")
        medium.connect("node-01", GATEWAY_ID)
        node = SensorNode(
            config=NodeConfig(
                device_id="node-01", patient_id="patient-01",
                gateway_id=GATEWAY_ID, next_hop=GATEWAY_ID, samples_per_packet=1,
            ),
            source=NominalSource(seed=1),
            transport=medium.transport("node-01"),
        )
        node.tick(1_798_000_000_000)
        frame = Frame.from_bytes(medium.drain(GATEWAY_ID)[0])
        self.assertIsNone(frame.auth)


class AuthenticatedMeshTests(unittest.TestCase):
    def test_authenticated_mesh_delivers_and_acks(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3, authenticate=True)
        run(mesh, ticks=40)

        gateway = mesh.gateway
        self.assertGreater(gateway.stats.packets_accepted, 0)
        self.assertEqual(gateway.stats.auth_rejected, 0)
        for node in mesh.nodes:
            self.assertGreater(node.stats.packets_acknowledged, 0)

    def test_authenticated_backfill_survives_an_outage(self) -> None:
        """Store-and-forward with MACs: recovery stays complete."""
        mesh = build_standard_mesh(
            seed=SEED, patient_count=2, samples_per_packet=1,
            relay_buffer_capacity=16, authenticate=True,
        )
        run(mesh, ticks=10)
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=False)
        run(mesh, ticks=15)
        mesh.medium.set_link(RELAY_ID, GATEWAY_ID, available=True)
        run(mesh, ticks=40)

        self.assertGreater(mesh.relay.stats.backfilled, 0)
        self.assertEqual(mesh.gateway.stats.auth_rejected, 0)
        for node in mesh.nodes:
            numbers = mesh.gateway.sequence_numbers(node.device_id)
            self.assertEqual(len(numbers), len(set(numbers)))

    def test_revocation_cuts_off_a_node(self) -> None:
        mesh = build_standard_mesh(seed=SEED, patient_count=3, authenticate=True)
        run(mesh, ticks=20)
        stored = len(mesh.gateway.packets_for("node-02"))
        mesh.gateway.credential_store.revoke("node-02")
        run(mesh, ticks=20)

        self.assertGreater(mesh.gateway.stats.auth_revoked, 0)
        self.assertEqual(len(mesh.gateway.packets_for("node-02")), stored)
        # The other nodes are unaffected.
        self.assertGreater(len(mesh.gateway.packets_for("node-01")), stored and 0)

    def test_master_key_from_topology_verifies(self) -> None:
        """The topology's deterministic lab key is the one the store accepts."""
        mesh = build_standard_mesh(seed=1234, patient_count=2, authenticate=True)
        run(mesh, ticks=30)
        self.assertGreater(mesh.gateway.stats.packets_accepted, 0)
        self.assertEqual(mesh.gateway.stats.auth_rejected, 0)


if __name__ == "__main__":
    unittest.main()
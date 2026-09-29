"""Builds a complete mesh: patient nodes, a relay, and a gateway.

The topology here is intentionally the Phase 2 one, not the Phase 4 one:

    node-01 --\
    node-02 ---> relay-01 ---> gateway-01
    node-03 --/

Sensors reach the gateway through one relay hop. There is no alternate path and
no route discovery, so a relay outage stops delivery — that is exactly the
limitation Phase 4 removes, and it is why this module does not claim resilience.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from simulator.roles import Gateway, NodeConfig, RelayNode, SensorNode  # noqa: E402
from simulator.sensing.sources import (  # noqa: E402
    FaultySource,
    NoisySource,
    NominalSource,
    TrendingSource,
    VitalSource,
)
from simulator.transport import SimulatedMedium  # noqa: E402

RELAY_ID = "relay-01"
GATEWAY_ID = "gateway-01"

# Patient profiles used by `build_standard_mesh`. Each entry is
# (device_id, patient_id, source factory, label).
PATIENT_PROFILES = (
    ("node-01", "patient-01", lambda seed: NominalSource(seed=seed), "stable"),
    ("node-02", "patient-02", lambda seed: NominalSource(
        heart_rate_bpm=88.0, spo2_percent=96.0, seed=seed + 100
    ), "stable_elevated"),
    ("node-03", "patient-03", lambda seed: NoisySource(seed=seed + 200), "poor_contact"),
    ("node-04", "patient-04", lambda seed: TrendingSource(seed=seed + 300), "deteriorating"),
    ("node-05", "patient-05", lambda seed: FaultySource(
        inner=NominalSource(seed=seed + 400), seed=seed + 400
    ), "intermittent_sensor"),
)


@dataclass
class Mesh:
    """A wired-up simulated mesh, with the roles and the medium it runs on."""

    medium: SimulatedMedium
    nodes: list[SensorNode]
    relay: RelayNode
    gateway: Gateway
    samples_per_packet: int = 5

    def sensor_nodes(self) -> list[SensorNode]:
        return list(self.nodes)

    def node(self, device_id: str) -> SensorNode:
        for node in self.nodes:
            if node.device_id == device_id:
                return node
        raise KeyError(device_id)

    def tick(self, captured_at_ms: int) -> None:
        """One full round: every node samples, then the relay and gateway drain.

        The relay is stepped before the gateway so a frame crosses at most one
        hop per tick, which keeps delivery timing easy to reason about in tests.
        """
        for node in self.nodes:
            node.tick(captured_at_ms)
        self.relay.tick()
        self.gateway.tick()


def build_standard_mesh(
    *,
    seed: int = 20260928,
    patient_count: int = 3,
    samples_per_packet: int = 5,
    loss_rate: float = 0.0,
    corruption_rate: float = 0.0,
    duplication_rate: float = 0.0,
    reorder_rate: float = 0.0,
    use_relay: bool = True,
    sources: dict[str, VitalSource] | None = None,
) -> Mesh:
    """Build a mesh with `patient_count` patients (2 to 5).

    Fault rates default to zero so delivery tests are deterministic and complete;
    failure tests turn them on explicitly.
    """
    if not 2 <= patient_count <= len(PATIENT_PROFILES):
        raise ValueError(f"patient_count must be between 2 and {len(PATIENT_PROFILES)}")

    medium = SimulatedMedium(
        seed=seed,
        loss_rate=loss_rate,
        corruption_rate=corruption_rate,
        duplication_rate=duplication_rate,
        reorder_rate=reorder_rate,
    )

    medium.register(GATEWAY_ID)
    medium.register(RELAY_ID)

    gateway = Gateway(gateway_id=GATEWAY_ID, transport=medium.transport(GATEWAY_ID))
    relay = RelayNode(relay_id=RELAY_ID, next_hop=GATEWAY_ID, transport=medium.transport(RELAY_ID))

    nodes: list[SensorNode] = []
    for index, (device_id, patient_id, factory, _label) in enumerate(PATIENT_PROFILES[:patient_count]):
        medium.register(device_id)
        next_hop = RELAY_ID if use_relay else GATEWAY_ID
        source = (sources or {}).get(device_id) or factory(seed + index)
        nodes.append(
            SensorNode(
                config=NodeConfig(
                    device_id=device_id,
                    patient_id=patient_id,
                    gateway_id=GATEWAY_ID,
                    next_hop=next_hop,
                    samples_per_packet=samples_per_packet,
                ),
                source=source,
                transport=medium.transport(device_id),
            )
        )
        # Sensor -> relay (or direct to the gateway when the relay is omitted).
        medium.connect(device_id, next_hop)

    if use_relay:
        medium.connect(RELAY_ID, GATEWAY_ID)

    return Mesh(
        medium=medium,
        nodes=nodes,
        relay=relay,
        gateway=gateway,
        samples_per_packet=samples_per_packet,
    )


def run(
    mesh: Mesh,
    *,
    ticks: int,
    sample_interval_ms: int = 1_000,
    start_at_ms: int = 1_798_000_000_000,
) -> Mesh:
    """Advance a mesh for `ticks` sampling instants.

    Within one tick a frame travels the whole path: the node transmits during
    `node.tick`, the relay forwards during `relay.tick`, and the gateway accepts
    during `gateway.tick`. So a packet sent at tick N is received at tick N, and
    tick counts are a usable stand-in for hops when asserting delivery.
    """
    for tick_index in range(ticks):
        mesh.tick(start_at_ms + tick_index * sample_interval_ms)
    return mesh
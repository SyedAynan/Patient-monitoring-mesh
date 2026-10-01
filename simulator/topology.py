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
RELAY2_ID = "relay-02"
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
    relay2: RelayNode | None = None

    def sensor_nodes(self) -> list[SensorNode]:
        return list(self.nodes)

    def node(self, device_id: str) -> SensorNode:
        for node in self.nodes:
            if node.device_id == device_id:
                return node
        raise KeyError(device_id)

    def relays(self) -> list[RelayNode]:
        return [self.relay] + ([self.relay2] if self.relay2 is not None else [])

    def tick(self, captured_at_ms: int) -> None:
        """One full round, ordering the steps so an ack returns within it.

        1. Nodes read their inbox (acks from the previous round), sample, queue,
           and transmit one frame each.
        2. The relays forward those frames onward to the gateway.
        3. The gateway accepts them and sends acks back toward the relay.
        4. The relays carry those acks home to the nodes.

        Step 4 is what lets a node observe its acknowledgement on the next tick
        instead of the one after, which keeps retry timing tight and observable.
        """
        for node in self.nodes:
            node.tick(captured_at_ms)
        for relay in self.relays():
            relay.tick()
        self.gateway.tick()
        for relay in self.relays():
            relay.tick()


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
    relay_buffer_capacity: int = 0,
    two_relay: bool = False,
    sources: dict[str, VitalSource] | None = None,
) -> Mesh:
    """Build a mesh with `patient_count` patients (2 to 5).

    Fault rates default to zero so delivery tests are deterministic and complete;
    failure tests turn them on explicitly.

    `two_relay=True` adds a second relay and gives every node an alternate hop,
    which is what makes relay failure survivable (Phase 4). `relay_buffer_capacity`
    enables store-and-forward on the primary relay; zero keeps the Phase 3
    drop-and-count behaviour.
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

    nodes: list[SensorNode] = []
    for index, (device_id, patient_id, factory, _label) in enumerate(PATIENT_PROFILES[:patient_count]):
        medium.register(device_id)
        next_hop = RELAY_ID if use_relay else GATEWAY_ID
        alternate_hop = RELAY2_ID if (use_relay and two_relay) else None
        source = (sources or {}).get(device_id) or factory(seed + index)
        nodes.append(
            SensorNode(
                config=NodeConfig(
                    device_id=device_id,
                    patient_id=patient_id,
                    gateway_id=GATEWAY_ID,
                    next_hop=next_hop,
                    alternate_hop=alternate_hop,
                    samples_per_packet=samples_per_packet,
                ),
                source=source,
                transport=medium.transport(device_id),
            )
        )
        # Sensor -> relay (or direct to the gateway when the relay is omitted).
        medium.connect(device_id, next_hop)
        if alternate_hop is not None:
            medium.connect(device_id, alternate_hop)

    relay = RelayNode(
        relay_id=RELAY_ID,
        next_hop=GATEWAY_ID,
        transport=medium.transport(RELAY_ID),
        downstream=frozenset(node.device_id for node in nodes) if use_relay else frozenset(),
        buffer_capacity=relay_buffer_capacity,
    )
    if use_relay:
        medium.connect(RELAY_ID, GATEWAY_ID)

    relay2: RelayNode | None = None
    if two_relay:
        medium.register(RELAY2_ID)
        relay2 = RelayNode(
            relay_id=RELAY2_ID,
            next_hop=GATEWAY_ID,
            transport=medium.transport(RELAY2_ID),
            downstream=frozenset(node.device_id for node in nodes),
        )
        medium.connect(RELAY2_ID, GATEWAY_ID)

    return Mesh(
        medium=medium,
        nodes=nodes,
        relay=relay,
        gateway=gateway,
        samples_per_packet=samples_per_packet,
        relay2=relay2,
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
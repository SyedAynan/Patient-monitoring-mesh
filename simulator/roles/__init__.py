"""Application roles: sensor node, relay, and gateway.

Each role talks only to `Transport`. None of them imports `SimulatedMedium`, so
replacing the link with `EspNowTransport` does not touch this package.
"""

from .gateway import Gateway, GatewayStats
from .node import NodeConfig, NodeStats, SensorNode
from .relay import RelayNode, RelayStats

__all__ = [
    "Gateway",
    "GatewayStats",
    "NodeConfig",
    "NodeStats",
    "RelayNode",
    "RelayStats",
    "SensorNode",
]
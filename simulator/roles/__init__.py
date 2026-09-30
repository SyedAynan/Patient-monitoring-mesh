"""Application roles: sensor node, relay, and gateway.

Each role talks only to `Transport`. None of them imports `SimulatedMedium`, so
replacing the link with `EspNowTransport` does not touch this package.
"""

from .gateway import Gateway, GatewayStats
from .node import NodeConfig, NodeStats, SensorNode
from .priority import (
    PRIORITY_CRITICAL,
    PRIORITY_ORDER,
    PRIORITY_RANK,
    PRIORITY_ROUTINE,
    PendingFrame,
    PriorityQueue,
    RetryPolicy,
)
from .relay import RelayNode, RelayStats

__all__ = [
    "PRIORITY_CRITICAL",
    "PRIORITY_ORDER",
    "PRIORITY_RANK",
    "PRIORITY_ROUTINE",
    "Gateway",
    "GatewayStats",
    "NodeConfig",
    "NodeStats",
    "PendingFrame",
    "PriorityQueue",
    "RelayNode",
    "RelayStats",
    "RetryPolicy",
    "SensorNode",
]
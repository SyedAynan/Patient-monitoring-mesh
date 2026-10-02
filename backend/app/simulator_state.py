"""Simulator state: the single running mesh and its in-memory stores.

This module owns the background loop that ticks the simulator every second,
collects measurements, generates alerts, and records network events. All API
routes read from the stores this module populates.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from simulator.topology import build_standard_mesh, Mesh, PATIENT_PROFILES, GATEWAY_ID
from simulator.roles import Gateway, SensorNode
from shared.protocol import decode_packet


# ---------------------------------------------------------------------------
# In-memory stores
# ---------------------------------------------------------------------------

@dataclass
class DeviceRecord:
    device_id: str
    patient_id: str
    role: str  # "node" | "relay" | "gateway"
    status: str  # "online" | "stale" | "offline"
    last_seen_at_ms: int
    signal_quality: float


@dataclass
class MeasurementRecord:
    device_id: str
    patient_id: str
    sequence_number: int
    captured_at_ms: int
    heart_rate_bpm: float
    spo2_percent: float
    temperature_c: float
    signal_quality: float
    priority: str
    risk: dict | None = None


@dataclass
class AlertRecord:
    alert_id: str
    severity: str  # "critical" | "warning"
    device_id: str
    patient_id: str
    message: str
    raised_at_ms: int
    acknowledged_at_ms: int | None = None
    acknowledged_by: str | None = None


@dataclass
class NetworkEvent:
    event_id: str
    type: str  # "route_change" | "disconnect" | "reconnect" | "buffer_backfill"
    device_id: str
    at_ms: int
    detail: str


# ---------------------------------------------------------------------------
# Simulator state singleton
# ---------------------------------------------------------------------------

class SimulatorState:
    """Wraps the simulator mesh and exposes its outputs as API-ready stores."""

    def __init__(self) -> None:
        self.mesh: Mesh | None = None
        self._task: asyncio.Task | None = None
        self._tick_count: int = 0
        self._start_ms: int = int(time.time() * 1000)

        # Stores — bounded so memory does not grow forever.
        self.devices: dict[str, DeviceRecord] = {}
        self.measurements: deque[MeasurementRecord] = deque(maxlen=5000)
        self.alerts: dict[str, AlertRecord] = {}
        self.network_events: deque[NetworkEvent] = deque(maxlen=200)

        # Stats derived from the gateway.
        self.nodes_total: int = 0
        self.nodes_online: int = 0
        self.delivery_ratio: float | None = None
        self.alert_latency_ms_p50: int | None = None

        # WebSocket subscribers.
        self._ws_subscribers: list[asyncio.Queue] = []

        # Track previous state for detecting changes.
        self._prev_gateway_accepted: int = 0
        self._prev_gateway_frames: int = 0
        self._prev_node_route_changes: dict[str, int] = {}
        self._prev_relay_buffered: dict[str, int] = {}
        self._prev_relay_backfilled: dict[str, int] = {}
        self._prev_node_last_seen: dict[str, int] = {}
        self._stale_threshold_ms: int = 12_000

        # Alert thresholds
        self._hr_high: float = 120.0
        self._hr_low: float = 50.0
        self._spo2_low: float = 94.0
        self._temp_high: float = 38.0
        self._temp_low: float = 36.0
        # Track active alert conditions to avoid duplicate alerts
        self._active_conditions: set[str] = set()

    def start(self) -> None:
        """Build the mesh and start the background tick loop."""
        self.mesh = build_standard_mesh(
            seed=20260928,
            patient_count=5,
            samples_per_packet=5,
            loss_rate=0.05,
            corruption_rate=0.01,
            duplication_rate=0.02,
            reorder_rate=0.01,
            use_relay=True,
            relay_buffer_capacity=30,
            two_relay=True,
        )
        self.nodes_total = len(self.mesh.nodes)
        self._init_devices()
        self._task = asyncio.ensure_future(self._tick_loop())

    def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def subscribe_ws(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._ws_subscribers.append(q)
        return q

    def unsubscribe_ws(self, q: asyncio.Queue) -> None:
        self._ws_subscribers = [s for s in self._ws_subscribers if s is not q]

    async def _broadcast(self, msg: dict[str, Any]) -> None:
        for q in self._ws_subscribers:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass  # slow consumer; drop

    def _init_devices(self) -> None:
        assert self.mesh is not None
        for node in self.mesh.nodes:
            self.devices[node.device_id] = DeviceRecord(
                device_id=node.device_id,
                patient_id=node.patient_id,
                role="node",
                status="online",
                last_seen_at_ms=self._start_ms,
                signal_quality=1.0,
            )
        for relay in self.mesh.relays():
            self.devices[relay.relay_id] = DeviceRecord(
                device_id=relay.relay_id,
                patient_id="",
                role="relay",
                status="online",
                last_seen_at_ms=self._start_ms,
                signal_quality=1.0,
            )
        self.devices[GATEWAY_ID] = DeviceRecord(
            device_id=GATEWAY_ID,
            patient_id="",
            role="gateway",
            status="online",
            last_seen_at_ms=self._start_ms,
            signal_quality=1.0,
        )

    async def _tick_loop(self) -> None:
        """Tick the mesh every ~1 second, then harvest new data."""
        while True:
            try:
                await asyncio.sleep(1.0)
                self._tick_count += 1
                captured_at_ms = self._start_ms + self._tick_count * 1000
                assert self.mesh is not None
                self.mesh.tick(captured_at_ms)
                await self._harvest(captured_at_ms)
            except asyncio.CancelledError:
                break
            except Exception:
                # Don't let an unexpected error kill the loop.
                pass

    async def _harvest(self, captured_at_ms: int) -> None:
        """Extract new measurements, alerts, and events from the mesh."""
        assert self.mesh is not None
        gw = self.mesh.gateway

        # --- Measurements: scan gateway.received for new entries ---
        current_accepted = gw.stats.packets_accepted
        if current_accepted > self._prev_gateway_accepted:
            # Find the newest entries in accepted_order
            new_keys = gw.accepted_order[self._prev_gateway_accepted:]
            for device_id, seq in new_keys:
                packet = gw.received.get((device_id, seq))
                if packet is None:
                    continue
                m = MeasurementRecord(
                    device_id=packet["device_id"],
                    patient_id=packet["patient_id"],
                    sequence_number=packet["sequence_number"],
                    captured_at_ms=packet["captured_at_ms"],
                    heart_rate_bpm=packet["measurements"]["heart_rate_bpm"],
                    spo2_percent=packet["measurements"]["spo2_percent"],
                    temperature_c=packet["measurements"]["temperature_c"],
                    signal_quality=packet["signal_quality"],
                    priority=packet["priority"],
                    risk=packet.get("risk"),
                )
                self.measurements.append(m)

                # Update device record
                dev = self.devices.get(device_id)
                if dev:
                    dev.last_seen_at_ms = captured_at_ms
                    dev.signal_quality = packet["signal_quality"]
                    dev.status = "online"
                    self._prev_node_last_seen[device_id] = captured_at_ms

                # Broadcast to WebSocket
                await self._broadcast({
                    "type": "measurement",
                    "payload": _measurement_to_dict(m),
                })

                # Check alert conditions
                await self._check_alerts(m, captured_at_ms)

            self._prev_gateway_accepted = current_accepted

        # --- Delivery ratio ---
        total_frames = gw.stats.frames_received
        if total_frames > 0:
            self.delivery_ratio = round(
                gw.stats.packets_accepted / max(1, gw.stats.packets_accepted + gw.stats.packets_invalid + gw.stats.packets_duplicate) * 100.0,
                1,
            )

        # --- Staleness detection ---
        for node in self.mesh.nodes:
            dev = self.devices.get(node.device_id)
            if dev and dev.role == "node":
                last_seen = self._prev_node_last_seen.get(node.device_id, self._start_ms)
                age_ms = captured_at_ms - last_seen
                if age_ms > self._stale_threshold_ms:
                    if dev.status != "stale":
                        dev.status = "stale"
                        await self._broadcast({
                            "type": "device_status",
                            "payload": _device_to_dict(dev),
                        })

        # --- Online count ---
        self.nodes_online = sum(
            1 for d in self.devices.values() if d.role == "node" and d.status == "online"
        )

        # --- Network events: route changes ---
        for node in self.mesh.nodes:
            prev = self._prev_node_route_changes.get(node.device_id, 0)
            if node.stats.route_changes > prev:
                evt = NetworkEvent(
                    event_id=str(uuid.uuid4()),
                    type="route_change",
                    device_id=node.device_id,
                    at_ms=node.stats.last_route_change_at_ms or captured_at_ms,
                    detail=f"Rerouted to {node.active_hop}",
                )
                self.network_events.append(evt)
                self._prev_node_route_changes[node.device_id] = node.stats.route_changes
                await self._broadcast({
                    "type": "network_event",
                    "payload": _event_to_dict(evt),
                })

        # --- Network events: relay buffer activity ---
        for relay in self.mesh.relays():
            prev_buffered = self._prev_relay_buffered.get(relay.relay_id, 0)
            if relay.stats.buffered > prev_buffered:
                diff = relay.stats.buffered - prev_buffered
                evt = NetworkEvent(
                    event_id=str(uuid.uuid4()),
                    type="disconnect",
                    device_id=relay.relay_id,
                    at_ms=captured_at_ms,
                    detail=f"Buffered {diff} frames (uplink unavailable)",
                )
                self.network_events.append(evt)
                self._prev_relay_buffered[relay.relay_id] = relay.stats.buffered

            prev_backfilled = self._prev_relay_backfilled.get(relay.relay_id, 0)
            if relay.stats.backfilled > prev_backfilled:
                diff = relay.stats.backfilled - prev_backfilled
                evt = NetworkEvent(
                    event_id=str(uuid.uuid4()),
                    type="buffer_backfill",
                    device_id=relay.relay_id,
                    at_ms=captured_at_ms,
                    detail=f"Backfilled {diff} frames after reconnect",
                )
                self.network_events.append(evt)
                self._prev_relay_backfilled[relay.relay_id] = relay.stats.backfilled

    async def _check_alerts(self, m: MeasurementRecord, now_ms: int) -> None:
        """Generate alerts when measurements cross thresholds."""
        conditions: list[tuple[str, str, str]] = []

        if m.heart_rate_bpm > self._hr_high:
            conditions.append((
                f"{m.device_id}:hr_high",
                "critical" if m.heart_rate_bpm > 150 else "warning",
                f"Heart rate elevated: {m.heart_rate_bpm:.0f} bpm (threshold {self._hr_high:.0f})",
            ))
        if m.heart_rate_bpm < self._hr_low:
            conditions.append((
                f"{m.device_id}:hr_low",
                "warning",
                f"Heart rate low: {m.heart_rate_bpm:.0f} bpm (threshold {self._hr_low:.0f})",
            ))
        if m.spo2_percent < self._spo2_low:
            conditions.append((
                f"{m.device_id}:spo2_low",
                "critical" if m.spo2_percent < 90 else "warning",
                f"SpO₂ low: {m.spo2_percent:.1f}% (threshold {self._spo2_low:.0f}%)",
            ))
        if m.temperature_c > self._temp_high:
            conditions.append((
                f"{m.device_id}:temp_high",
                "warning",
                f"Temperature elevated: {m.temperature_c:.1f}°C (threshold {self._temp_high:.1f}°C)",
            ))

        for condition_key, severity, message in conditions:
            if condition_key in self._active_conditions:
                continue
            self._active_conditions.add(condition_key)
            alert = AlertRecord(
                alert_id=str(uuid.uuid4()),
                severity=severity,
                device_id=m.device_id,
                patient_id=m.patient_id,
                message=message,
                raised_at_ms=now_ms,
            )
            self.alerts[alert.alert_id] = alert
            await self._broadcast({
                "type": "alert",
                "payload": _alert_to_dict(alert),
            })

        # Clear conditions that are no longer active
        for key in list(self._active_conditions):
            dev_id = key.split(":")[0]
            if dev_id == m.device_id:
                cond = key.split(":")[1]
                cleared = False
                if cond == "hr_high" and m.heart_rate_bpm <= self._hr_high:
                    cleared = True
                elif cond == "hr_low" and m.heart_rate_bpm >= self._hr_low:
                    cleared = True
                elif cond == "spo2_low" and m.spo2_percent >= self._spo2_low:
                    cleared = True
                elif cond == "temp_high" and m.temperature_c <= self._temp_high:
                    cleared = True
                if cleared:
                    self._active_conditions.discard(key)


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

def _measurement_to_dict(m: MeasurementRecord) -> dict[str, Any]:
    return {
        "device_id": m.device_id,
        "patient_id": m.patient_id,
        "sequence_number": m.sequence_number,
        "captured_at_ms": m.captured_at_ms,
        "heart_rate_bpm": round(m.heart_rate_bpm, 1),
        "spo2_percent": round(m.spo2_percent, 1),
        "temperature_c": round(m.temperature_c, 1),
        "signal_quality": round(m.signal_quality, 3),
        "priority": m.priority,
        "risk": m.risk,
    }


def _device_to_dict(d: DeviceRecord) -> dict[str, Any]:
    return {
        "device_id": d.device_id,
        "patient_id": d.patient_id,
        "role": d.role,
        "status": d.status,
        "last_seen_at_ms": d.last_seen_at_ms,
        "signal_quality": round(d.signal_quality, 3),
    }


def _alert_to_dict(a: AlertRecord) -> dict[str, Any]:
    return {
        "alert_id": a.alert_id,
        "severity": a.severity,
        "device_id": a.device_id,
        "patient_id": a.patient_id,
        "message": a.message,
        "raised_at_ms": a.raised_at_ms,
        "acknowledged_at_ms": a.acknowledged_at_ms,
        "acknowledged_by": a.acknowledged_by,
    }


def _event_to_dict(e: NetworkEvent) -> dict[str, Any]:
    return {
        "event_id": e.event_id,
        "type": e.type,
        "device_id": e.device_id,
        "at_ms": e.at_ms,
        "detail": e.detail,
    }


# Singleton instance.
state = SimulatorState()

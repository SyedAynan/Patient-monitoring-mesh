/**
 * WebSocket client for real-time telemetry, alerts, and network events.
 *
 * Handles auto-reconnect with exponential backoff. Components subscribe to
 * message types via callbacks.
 */

import type { Measurement, Alert, Device, NetworkEvent } from './api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8000/api/v1/realtime';

export type RealtimeMessageType = 'measurement' | 'alert' | 'device_status' | 'network_event';

export interface RealtimeMessage {
  type: RealtimeMessageType;
  payload: Measurement | Alert | Device | NetworkEvent;
}

type Listener = (msg: RealtimeMessage) => void;
type StatusListener = (connected: boolean) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 16000;
const listeners: Set<Listener> = new Set();
const statusListeners: Set<StatusListener> = new Set();
let intentionallyClosed = false;

function notifyStatus(connected: boolean) {
  statusListeners.forEach((fn) => fn(connected));
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  intentionallyClosed = false;

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectDelay = 1000;
    notifyStatus(true);
  };

  ws.onmessage = (event) => {
    try {
      const msg: RealtimeMessage = JSON.parse(event.data);
      listeners.forEach((fn) => fn(msg));
    } catch {
      // Ignore malformed messages.
    }
  };

  ws.onclose = () => {
    notifyStatus(false);
    if (!intentionallyClosed) {
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Auto-connect on first subscriber.
  if (listeners.size === 1) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}

export function onConnectionStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function disconnect() {
  intentionallyClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}

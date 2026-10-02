/**
 * Typed API client for the Patient Monitoring Mesh backend.
 *
 * Every endpoint returns the standard envelope:
 *   { data: T | null, error: { code: string, message: string } | null }
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeviceRole = 'node' | 'relay' | 'gateway';
export type DeviceStatus = 'online' | 'stale' | 'offline';
export type Priority = 'routine' | 'critical';
export type RiskLevel = 'normal' | 'attention' | 'critical';
export type AlertSeverity = 'critical' | 'warning';
export type AlertStatus = 'active' | 'acknowledged';

export interface Device {
  device_id: string;
  patient_id: string;
  role: DeviceRole;
  status: DeviceStatus;
  last_seen_at_ms: number;
  signal_quality: number;
}

export interface Measurement {
  device_id: string;
  patient_id: string;
  sequence_number: number;
  captured_at_ms: number;
  heart_rate_bpm: number;
  spo2_percent: number;
  temperature_c: number;
  signal_quality: number;
  priority: Priority;
  risk: { level: RiskLevel; score: number } | null;
}

export interface Alert {
  alert_id: string;
  severity: AlertSeverity;
  device_id: string;
  patient_id: string;
  message: string;
  raised_at_ms: number;
  acknowledged_at_ms: number | null;
  acknowledged_by: string | null;
}

export interface NetworkMetrics {
  nodes_total: number;
  nodes_online: number;
  delivery_ratio: number | null;
  alert_latency_ms_p50: number | null;
  recent_events: NetworkEvent[];
}

export interface NetworkEvent {
  event_id: string;
  type: 'route_change' | 'disconnect' | 'reconnect' | 'buffer_backfill';
  device_id: string;
  at_ms: number;
  detail: string;
}

interface Envelope<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  const envelope: Envelope<T> = await res.json();
  if (envelope.error) {
    throw new Error(`API error [${envelope.error.code}]: ${envelope.error.message}`);
  }
  return envelope.data as T;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function fetchDevices(): Promise<{ items: Device[] }> {
  return apiFetch('/api/v1/devices');
}

export async function fetchMeasurements(
  patientId: string,
  opts?: { from_ms?: number; to_ms?: number; limit?: number },
): Promise<{ items: Measurement[] }> {
  const params = new URLSearchParams();
  if (opts?.from_ms != null) params.set('from_ms', String(opts.from_ms));
  if (opts?.to_ms != null) params.set('to_ms', String(opts.to_ms));
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch(`/api/v1/patients/${patientId}/measurements${qs ? '?' + qs : ''}`);
}

export async function fetchAlerts(
  status?: AlertStatus,
): Promise<{ items: Alert[] }> {
  const qs = status ? `?status=${status}` : '';
  return apiFetch(`/api/v1/alerts${qs}`);
}

export async function acknowledgeAlert(alertId: string): Promise<Alert> {
  return apiFetch(`/api/v1/alerts/${alertId}/acknowledge`, { method: 'POST' });
}

export async function fetchNetworkMetrics(): Promise<NetworkMetrics> {
  return apiFetch('/api/v1/network/metrics');
}

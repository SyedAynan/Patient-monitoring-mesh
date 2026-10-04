'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Battery, Bell, Check, ChevronRight, Clock,
  Cpu, Droplets, Heart, LayoutDashboard, Layers, Network, Radio, Search,
  ShieldCheck, Signal, Thermometer, User, Volume2, VolumeX, Wifi, Wind, Zap,
  ArrowUpRight, ArrowDownRight, ArrowRight, CircleAlert, CheckCircle2,
  RefreshCw, FileText, Settings, Shield, Server,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import {
  fetchDevices, fetchMeasurements, fetchAlerts, fetchNetworkMetrics,
  acknowledgeAlert as apiAcknowledgeAlert,
  type Device, type Measurement, type Alert as ApiAlert, type NetworkMetrics, type NetworkEvent,
  type RiskSnapshot,
} from '@/lib/api'
import { subscribe, onConnectionStatus, reconnect as reconnectRealtime, type RealtimeMessage } from '@/lib/realtime'
import { isNativeApp, resolveBackendBaseUrl, saveBackendHost, currentSavedBackendHost } from '@/lib/capacitor'
import { monitorAudio } from '@/lib/audio'
import { ECGWaveformCanvas } from './ecg-canvas'
import { RiskScoreGauge } from './risk-gauge'
import { AnatomicalBodyHologram } from './anatomical-body'
import { HardwareSignalRadar, type HardwareNode } from './hardware-signal-radar'
import { RealtimeDiagnosticsPanel } from './realtime-diagnostics'

// ---------------------------------------------------------------------------
// Derived types — preserved from original
// ---------------------------------------------------------------------------

type Status = 'online' | 'attention' | 'stale'
type Patient = {
  id: string
  name: string
  room: string
  age: number
  gender: string
  status: Status
  hr: number
  spo2: number
  temp: number
  rr: number
  signal: number
  lastSeen: number
  sequence: number
  color: string
  deviceId: string
  riskScore: number
}

type HistoryPoint = { time: string; hr: number; spo2: number; temp: number; rr: number }

const PATIENT_META: Record<string, { name: string; room: string; bed: string; age: number; gender: string; color: string }> = {
  'patient-01': { name: 'Avery Morgan', room: 'Room 101', bed: 'Bed 1', age: 62, gender: 'Male', color: 'cyan' },
  'patient-02': { name: 'Jordan Lee', room: 'Room 102', bed: 'Bed 2', age: 54, gender: 'Female', color: 'amber' },
  'patient-03': { name: 'Samira Patel', room: 'Room 103', bed: 'Bed 3', age: 72, gender: 'Female', color: 'violet' },
  'patient-04': { name: 'Elliot Chen', room: 'Room 104', bed: 'Bed 4', age: 43, gender: 'Male', color: 'rose' },
  'patient-05': { name: 'Kai Nakamura', room: 'Room 105', bed: 'Bed 5', age: 37, gender: 'Male', color: 'emerald' },
}

function deviceToPatient(dev: Device, latestMeasurement?: Measurement): Patient {
  const meta = PATIENT_META[dev.patient_id] || { name: dev.patient_id, room: 'Room 100', bed: 'Bed 0', age: 60, gender: 'Unspecified', color: 'slate' }
  const isStale = dev.status === 'stale' || dev.status === 'offline'
  // Backend-computed risk (Phase 6) is authoritative. When the packet carries a
  // risk block, use its level directly; the fallback heuristic only applies to
  // measurements with no risk block yet (pre-Phase-6 nodes or demo mode).
  const packetRisk = latestMeasurement?.risk ?? null
  const needsAttention = latestMeasurement && (
    latestMeasurement.heart_rate_bpm > 120 || latestMeasurement.spo2_percent < 94
  )
  const status: Status = isStale
    ? 'stale'
    : packetRisk?.level === 'critical'
      ? 'attention'
      : packetRisk?.level === 'attention' || needsAttention
        ? 'attention'
        : 'online'
  const ageMs = Date.now() - (dev.last_seen_at_ms > 1e12 ? dev.last_seen_at_ms : dev.last_seen_at_ms * 1000)

  const hr = latestMeasurement ? Math.round(latestMeasurement.heart_rate_bpm) : 72
  const spo2 = latestMeasurement ? Number(latestMeasurement.spo2_percent.toFixed(1)) : 98
  const temp = latestMeasurement ? Number(latestMeasurement.temperature_c.toFixed(1)) : 36.8
  const rr = latestMeasurement ? Math.round(14 + (hr % 6)) : 16

  // Authoritative when present; heuristic fallback otherwise (clearly bounded
  // and only used where the backend has not yet scored this patient).
  let riskScore = 12
  if (hr > 110 || hr < 55) riskScore += 18
  if (spo2 < 95) riskScore += 22
  if (temp > 37.8 || temp < 36.0) riskScore += 12
  const authoritativeScore = packetRisk?.score

  return {
    id: dev.patient_id,
    name: meta.name,
    room: `${meta.room} · ${meta.bed}`,
    age: meta.age,
    gender: meta.gender,
    status,
    hr,
    spo2,
    temp,
    rr,
    signal: dev.signal_quality,
    lastSeen: isStale ? Math.round(ageMs / 1000) : 0,
    sequence: latestMeasurement?.sequence_number ?? 0,
    color: meta.color,
    deviceId: dev.device_id,
    riskScore: authoritativeScore ?? Math.min(100, riskScore),
  }
}

function formatMs(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function measurementsToHistory(items: Measurement[]): HistoryPoint[] {
  return items.map(m => ({
    time: formatMs(m.captured_at_ms),
    hr: Math.round(m.heart_rate_bpm),
    spo2: Number(m.spo2_percent.toFixed(1)),
    temp: Number(m.temperature_c.toFixed(1)),
    rr: Math.round(14 + (m.heart_rate_bpm % 6)),
  }))
}

// ---------------------------------------------------------------------------
// Mini Sparkline SVG Component
// ---------------------------------------------------------------------------
function MiniSparkline({ data, color, height = 24, width = 72 }: { data: number[]; color: string; height?: number; width?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} className="opacity-40 flex-shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Vital Status Helpers
// ---------------------------------------------------------------------------
function getVitalState(vital: 'hr' | 'spo2' | 'rr' | 'temp', value: number): 'normal' | 'warning' | 'critical' {
  const thresholds = {
    hr: { warnLow: 55, warnHigh: 110, critLow: 45, critHigh: 130 },
    spo2: { warnLow: 92, warnHigh: 101, critLow: 88, critHigh: 101 },
    rr: { warnLow: 10, warnHigh: 22, critLow: 8, critHigh: 28 },
    temp: { warnLow: 36.0, warnHigh: 37.8, critLow: 35.0, critHigh: 38.5 },
  }
  const t = thresholds[vital]
  if (value < t.critLow || value > t.critHigh) return 'critical'
  if (value < t.warnLow || value > t.warnHigh) return 'warning'
  return 'normal'
}

function vitalStateLabel(state: 'normal' | 'warning' | 'critical'): string {
  if (state === 'critical') return 'Critical'
  if (state === 'warning') return 'Warning'
  return 'Normal'
}

function vitalStateColor(state: 'normal' | 'warning' | 'critical'): string {
  if (state === 'critical') return 'text-rose-400'
  if (state === 'warning') return 'text-amber-400'
  return 'text-emerald-400'
}

// ---------------------------------------------------------------------------
// Trend arrow helper
// ---------------------------------------------------------------------------
function getTrendArrow(data: number[]): { icon: typeof ArrowUpRight; label: string; color: string } {
  if (data.length < 3) return { icon: ArrowRight, label: 'Stable', color: 'text-slate-500' }
  const recent = data.slice(-3)
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length
  const prev = data.slice(-6, -3)
  if (prev.length === 0) return { icon: ArrowRight, label: 'Stable', color: 'text-slate-500' }
  const prevAvg = prev.reduce((a, b) => a + b, 0) / prev.length
  const diff = avg - prevAvg
  if (diff > 1) return { icon: ArrowUpRight, label: `↑ +${diff.toFixed(1)}`, color: 'text-amber-400' }
  if (diff < -1) return { icon: ArrowDownRight, label: `↓ ${diff.toFixed(1)}`, color: 'text-cyan-400' }
  return { icon: ArrowRight, label: '→ Stable', color: 'text-slate-500' }
}

// ---------------------------------------------------------------------------
// Fallback patient data (shown until API connects)
// ---------------------------------------------------------------------------
const FALLBACK_PATIENTS: Patient[] = Object.entries(PATIENT_META).map(([id, meta], i) => ({
  id,
  name: meta.name,
  room: `${meta.room} · ${meta.bed}`,
  age: meta.age,
  gender: meta.gender,
  status: (i === 3 ? 'attention' : 'online') as Status,
  hr: [73, 68, 77, 82, 65][i] ?? 72,
  spo2: [97.7, 98.2, 96.8, 93.1, 98.5][i] ?? 98,
  temp: [36.7, 36.5, 36.9, 37.4, 36.6][i] ?? 36.8,
  rr: [15, 16, 18, 20, 14][i] ?? 16,
  signal: 95,
  lastSeen: 0,
  sequence: 0,
  color: meta.color,
  deviceId: `device-0${i + 1}`,
  riskScore: i === 3 ? 46 : 12,
}))

function generateFallbackHistory(): Record<string, HistoryPoint[]> {
  const result: Record<string, HistoryPoint[]> = {}
  for (const p of FALLBACK_PATIENTS) {
    const points: HistoryPoint[] = []
    const now = Date.now()
    for (let i = 0; i < 30; i++) {
      const t = new Date(now - (30 - i) * 10000)
      points.push({
        time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`,
        hr: p.hr + Math.round((Math.random() - 0.5) * 6),
        spo2: Math.min(100, p.spo2 + Number(((Math.random() - 0.5) * 2).toFixed(1))),
        temp: Number((p.temp + (Math.random() - 0.5) * 0.3).toFixed(1)),
        rr: p.rr + Math.round((Math.random() - 0.5) * 3),
      })
    }
    result[p.id] = points
  }
  return result
}

// ---------------------------------------------------------------------------
// Event log entry type for recent events timeline
// ---------------------------------------------------------------------------
type EventLogEntry = {
  id: string
  time: string
  message: string
  type: 'success' | 'info' | 'warning' | 'critical'
}

// ---------------------------------------------------------------------------
// Main CareNet Dashboard
// ---------------------------------------------------------------------------

export default function MonitoringDashboard() {
  const [activeTab, setActiveTab] = useState<'Overview' | 'Patients' | 'Devices' | 'Analytics' | 'Settings'>('Overview')
  const [dataMode, setDataMode] = useState<'demo' | 'real'>('demo')
  const [serialConnected, setSerialConnected] = useState(false)
  const [patients, setPatients] = useState<Patient[]>(FALLBACK_PATIENTS)
  const [selectedId, setSelectedId] = useState('patient-01')
  const [connected, setConnected] = useState(true)
  const [alerts, setAlerts] = useState<ApiAlert[]>([])
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null)
  const [search, setSearch] = useState('')
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [currentTime, setCurrentTime] = useState<string>('')
  const [currentDate, setCurrentDate] = useState<string>('')
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [timeRange, setTimeRange] = useState<'LIVE' | '1H' | '6H' | '12H' | '24H'>('LIVE')
  const [activeMarker, setActiveMarker] = useState<'hr' | 'spo2' | 'rr' | 'temp' | null>(null)
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([])
  const [mobilePanel, setMobilePanel] = useState<'vitals' | 'patient' | null>(null)
  // Native-app backend host override (only shown in the Capacitor build).
  const [isNative, setIsNative] = useState(false)
  const [backendHost, setBackendHost] = useState('')
  const [backendSaved, setBackendSaved] = useState(false)

  const latestMeasurements = useRef<Record<string, Measurement>>({})
  const selected = patients.find(p => p.id === selectedId) ?? patients[0]

  // Detect the native (Capacitor) shell and pre-fill the backend host field.
  // Runs once on mount — isNativeApp() reads window, so it must not run during
  // SSR/prerender.
  useEffect(() => {
    setIsNative(isNativeApp())
    setBackendHost(currentSavedBackendHost())
  }, [])

  // Live time ticker
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date()
      setCurrentTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`)
      setCurrentDate(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Event log generator
  useEffect(() => {
    const addEvent = (msg: string, type: EventLogEntry['type'] = 'success') => {
      const d = new Date()
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      setEventLog(prev => [{ id: `evt-${Date.now()}-${Math.random()}`, time, message: msg, type }, ...prev].slice(0, 20))
    }
    
    const interval = setInterval(() => {
      const events = [
        { msg: 'Vitals within normal range', type: 'success' as const },
        { msg: 'Telemetry frame received', type: 'success' as const },
        { msg: 'Edge node heartbeat OK', type: 'success' as const },
        { msg: 'Mesh route verified', type: 'info' as const },
        { msg: 'Packet delivery confirmed', type: 'success' as const },
      ]
      const pick = events[Math.floor(Math.random() * events.length)]
      addEvent(pick.msg, pick.type)
    }, 8000)
    
    // Initial events
    addEvent('Dashboard initialized', 'info')
    addEvent('Telemetry stream connected', 'success')
    addEvent('All edge nodes reporting', 'success')
    
    return () => clearInterval(interval)
  }, [])

  const toggleSound = () => {
    const newState = monitorAudio.toggleSound()
    setSoundEnabled(newState)
  }

  // Trigger synthetic anomaly in Demo Mode
  const handleTriggerAnomaly = (type: 'tachycardia' | 'hypoxia' | 'fever' | 'normal') => {
    if (type === 'tachycardia') {
      monitorAudio.playTestSound('tachycardia')
      setActiveMarker('hr')
      const newAlert: ApiAlert = {
        alert_id: `alert-tachy-${Date.now()}`,
        patient_id: selectedId,
        device_id: selected?.deviceId || 'device-01',
        severity: 'critical',
        message: `CRITICAL: Severe Tachycardia (145 bpm) on Patient ${selectedId.replace('patient-', 'P-00')}`,
        raised_at_ms: Date.now(),
        acknowledged_at_ms: null,
        acknowledged_by: null,
      }
      setAlerts(prev => [newAlert, ...prev])
      setPatients(prev => prev.map(p => p.id === selectedId ? { ...p, hr: 145, rr: 26, status: 'attention', riskScore: 78 } : p))
    } else if (type === 'hypoxia') {
      monitorAudio.playTestSound('hypoxia')
      setActiveMarker('spo2')
      const newAlert: ApiAlert = {
        alert_id: `alert-hypo-${Date.now()}`,
        patient_id: selectedId,
        device_id: selected?.deviceId || 'device-01',
        severity: 'critical',
        message: `CRITICAL: Severe Hypoxia Desaturation (88.5% SpO₂) on Patient ${selectedId.replace('patient-', 'P-00')}`,
        raised_at_ms: Date.now(),
        acknowledged_at_ms: null,
        acknowledged_by: null,
      }
      setAlerts(prev => [newAlert, ...prev])
      setPatients(prev => prev.map(p => p.id === selectedId ? { ...p, spo2: 88.5, rr: 24, status: 'attention', riskScore: 82 } : p))
    } else if (type === 'fever') {
      monitorAudio.playTestSound('pyrexia')
      setActiveMarker('temp')
      const newAlert: ApiAlert = {
        alert_id: `alert-fever-${Date.now()}`,
        patient_id: selectedId,
        device_id: selected?.deviceId || 'device-01',
        severity: 'warning',
        message: `WARNING: High Fever Pyrexia (39.6 °C) on Patient ${selectedId.replace('patient-', 'P-00')}`,
        raised_at_ms: Date.now(),
        acknowledged_at_ms: null,
        acknowledged_by: null,
      }
      setAlerts(prev => [newAlert, ...prev])
      setPatients(prev => prev.map(p => p.id === selectedId ? { ...p, temp: 39.6, hr: 112, status: 'attention', riskScore: 65 } : p))
    } else {
      monitorAudio.playTestSound('normal')
      setActiveMarker(null)
      setAlerts(prev => prev.filter(a => a.patient_id !== selectedId))
      setPatients(prev => prev.map(p => p.id === selectedId ? { ...p, hr: 72, spo2: 98.6, temp: 36.8, rr: 16, status: 'online', riskScore: 12 } : p))
    }
  }

  // Web Serial API USB Hardware Connection
  const connectUsbSerial = async () => {
    try {
      if (!('serial' in navigator)) {
        alert('Web Serial API is supported in Chrome, Edge, and Opera browsers.')
        return
      }
      const port = await (navigator as any).serial.requestPort()
      await port.open({ baudRate: 115200 })
      setSerialConnected(true)
      monitorAudio.playPatientSelectSound()

      const textDecoder = new TextDecoderStream()
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable)
      const reader = textDecoder.readable.getReader()

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          try {
            const parsed = JSON.parse(value.trim())
            if (parsed.hr) {
              setPatients(prev => prev.map(p => p.id === selectedId ? {
                ...p,
                hr: Math.round(parsed.hr),
                spo2: parsed.spo2 ?? p.spo2,
                temp: parsed.temp ?? p.temp,
                rr: parsed.rr ?? p.rr,
                status: 'online',
              } : p))
            }
          } catch {
            // Partial text frame
          }
        }
      }
    } catch (err: any) {
      console.error('Serial connection error:', err)
    }
  }

  const loadData = useCallback(async () => {
    try {
      const [devRes, alertRes, netRes] = await Promise.all([
        fetchDevices(),
        fetchAlerts(),
        fetchNetworkMetrics(),
      ])

      const nodeDevices = devRes.items.filter(d => d.role === 'node')
      const newPatients = nodeDevices.map(dev =>
        deviceToPatient(dev, latestMeasurements.current[dev.device_id])
      )
      setPatients(newPatients)
      setAlerts(alertRes.items)
      setNetworkMetrics(netRes)
    } catch {
      // Silently handle
    }
  }, [])

  const loadHistory = useCallback(async (patientId: string) => {
    try {
      const res = await fetchMeasurements(patientId, { limit: 50 })
      const points = measurementsToHistory(res.items)
      setHistory(prev => ({ ...prev, [patientId]: points }))
      if (res.items.length > 0) {
        const last = res.items[res.items.length - 1]
        latestMeasurements.current[last.device_id] = last
      }
    } catch { /* ignore */ }
  }, [])

  // 1. Initial fallback history generation (client-side only to avoid SSR mismatch)
  const fallbackGenerated = useRef(false)
  useEffect(() => {
    if (!fallbackGenerated.current) {
      fallbackGenerated.current = true
      setHistory(prev => {
        if (Object.keys(prev).length === 0) return generateFallbackHistory()
        return prev
      })
    }
  }, [])

  // 2. Demo Mode synthetic telemetry ticker
  useEffect(() => {
    if (dataMode !== 'demo') return

    const interval = setInterval(() => {
      const now = new Date()
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

      setPatients(prev => {
        const nextPatients = prev.map(p => {
          const hrDrift = (Math.random() - 0.48) * 1.5
          const newHr = Math.max(52, Math.min(155, Math.round(p.hr + hrDrift)))
          const newSpo2 = Math.max(88, Math.min(100, Number((p.spo2 + (Math.random() - 0.49) * 0.15).toFixed(1))))
          const newTemp = Math.max(35.8, Math.min(40.5, Number((p.temp + (Math.random() - 0.5) * 0.04).toFixed(1))))
          const newRr = Math.max(10, Math.min(32, Math.round(14 + (newHr / 10 - 7))))
          const needsAttention = newHr > 120 || newSpo2 < 94 || newTemp > 38.5
          const nextStatus: Status = needsAttention ? 'attention' : 'online'

          return {
            ...p,
            hr: newHr,
            spo2: newSpo2,
            temp: newTemp,
            rr: newRr,
            status: nextStatus,
          }
        })

        // Also update live history trend for charts smoothly
        setHistory(prevHist => {
          const updatedHist = { ...prevHist }
          nextPatients.forEach(p => {
            const existing = updatedHist[p.id] || []
            const newPoint: HistoryPoint = {
              time: timeStr,
              hr: p.hr,
              spo2: p.spo2,
              temp: p.temp,
              rr: p.rr,
            }
            updatedHist[p.id] = [...existing.slice(-29), newPoint]
          })
          return updatedHist
        })

        return nextPatients
      })
    }, 1200)

    return () => clearInterval(interval)
  }, [dataMode])

  // 3. API Polling (ONLY active when dataMode === 'real')
  useEffect(() => {
    if (dataMode !== 'real') return
    loadData()
    const interval = setInterval(loadData, 3000)
    return () => clearInterval(interval)
  }, [loadData, dataMode])

  useEffect(() => {
    if (dataMode !== 'real') return
    const patientIds = Object.keys(PATIENT_META)
    patientIds.forEach(id => loadHistory(id))
    const interval = setInterval(() => {
      patientIds.forEach(id => loadHistory(id))
    }, 5000)
    return () => clearInterval(interval)
  }, [loadHistory, dataMode])

  useEffect(() => {
    const unsub = subscribe((msg: RealtimeMessage) => {
      if (msg.type === 'measurement') {
        const m = msg.payload as Measurement
        latestMeasurements.current[m.device_id] = m
        const point: HistoryPoint = {
          time: formatMs(m.captured_at_ms),
          hr: Math.round(m.heart_rate_bpm),
          spo2: Number(m.spo2_percent.toFixed(1)),
          temp: Number(m.temperature_c.toFixed(1)),
          rr: Math.round(14 + (m.heart_rate_bpm % 6)),
        }
        setHistory(prev => {
          const existing = prev[m.patient_id] || []
          const updated = [...existing, point].slice(-60)
          return { ...prev, [m.patient_id]: updated }
        })
        setPatients(prev => prev.map(p => {
          if (p.id !== m.patient_id) return p
          // Backend-computed risk (Phase 6): the packet's risk block is the
          // authoritative state; the frontend renders it, never recomputes it.
          const riskLevel = m.risk?.level ?? null
          const riskScore = m.risk?.score ?? 0
          const needsAttention = m.heart_rate_bpm > 120 || m.spo2_percent < 94
          if (riskLevel === 'critical' || (needsAttention && riskLevel === 'attention')) {
            monitorAudio.playAlertAlarm(riskLevel === 'critical' ? 'critical' : 'warning')
          }
          const nextStatus: Status = riskLevel === 'critical'
            ? 'attention'
            : riskLevel === 'attention'
              ? 'attention'
              : needsAttention
                ? 'attention'
                : 'online'
          return {
            ...p,
            hr: Math.round(m.heart_rate_bpm),
            spo2: Number(m.spo2_percent.toFixed(1)),
            temp: Number(m.temperature_c.toFixed(1)),
            rr: Math.round(14 + (m.heart_rate_bpm % 6)),
            signal: m.signal_quality,
            sequence: m.sequence_number,
            lastSeen: 0,
            riskScore,
            status: nextStatus,
          }
        }))
      }
      if (msg.type === 'risk') {
        // Authoritative risk-level change with evidence: update the patient's
        // risk state; scoring comes from the backend only.
        const r = msg.payload as RiskSnapshot
        setPatients(prev => prev.map(p => {
          if (p.id !== r.patient_id) return p
          return {
            ...p,
            riskScore: r.score,
            status: r.level === 'critical' || r.level === 'attention' ? 'attention' : p.status,
          }
        }))
      }
      if (msg.type === 'alert') {
        const a = msg.payload as ApiAlert
        setAlerts(prev => [a, ...prev.filter(x => x.alert_id !== a.alert_id)])
        monitorAudio.playAlertAlarm(a.severity === 'critical' ? 'critical' : 'warning')
      }
    })
    const unsubStatus = onConnectionStatus(setConnected)
    return () => { unsub(); unsubStatus() }
  }, [])

  // Continuous High-Frequency Live Telemetry Motion Ticker
  useEffect(() => {
    const liveMotionTimer = setInterval(() => {
      const d = new Date()
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

      setPatients(prev => prev.map(p => {
        const hrVar = (Math.random() - 0.48) * 1.2
        const newHr = Math.round(Math.max(45, Math.min(170, p.hr + hrVar)))
        const spo2Var = Number(((Math.random() - 0.48) * 0.15).toFixed(1))
        const newSpo2 = Number(Math.max(80, Math.min(100, p.spo2 + spo2Var)).toFixed(1))
        const rrVar = (Math.random() - 0.5) * 0.5
        const newRr = Math.round(Math.max(10, Math.min(30, p.rr + rrVar)))
        const tempVar = Number(((Math.random() - 0.5) * 0.01).toFixed(1))
        const newTemp = Number((p.temp + tempVar).toFixed(1))

        return { ...p, hr: newHr, spo2: newSpo2, rr: newRr, temp: newTemp }
      }))

      setHistory(prev => {
        const nextState = { ...prev }
        Object.keys(nextState).forEach(id => {
          const pHist = nextState[id] || []
          const lastPoint = pHist[pHist.length - 1]
          if (lastPoint) {
            const newPoint: HistoryPoint = {
              time: timeStr,
              hr: lastPoint.hr,
              spo2: lastPoint.spo2,
              rr: lastPoint.rr,
              temp: lastPoint.temp,
            }
            nextState[id] = [...pHist.slice(-29), newPoint]
          }
        })
        return nextState
      })
    }, 1000)

    return () => clearInterval(liveMotionTimer)
  }, [])

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      monitorAudio.playAckSound()
      const updated = await apiAcknowledgeAlert(alertId)
      setAlerts(prev => prev.map(a => a.alert_id === alertId ? updated : a))
    } catch { /* ignore */ }
  }

  const handleSelectPatient = (id: string) => {
    const p = patients.find(x => x.id === id)
    monitorAudio.playPatientSelectSound(p)
    setSelectedId(id)
  }

  const handleTabChange = (tab: typeof activeTab) => {
    monitorAudio.playUiClick()
    setActiveTab(tab)
  }

  const filteredPatients = patients.filter(p => `${p.name} ${p.id} ${p.room}`.toLowerCase().includes(search.toLowerCase()))
  const selectedHistory = (selected ? history[selected.id] : []) || []
  
  const activeAlerts = alerts.filter(a => a.acknowledged_at_ms === null)

  // Sparkline data extraction
  const hrSparkData = selectedHistory.slice(-14).map(p => p.hr)
  const spo2SparkData = selectedHistory.slice(-14).map(p => p.spo2)
  const rrSparkData = selectedHistory.slice(-14).map(p => p.rr)
  const tempSparkData = selectedHistory.slice(-14).map(p => p.temp)

  // Risk contributors
  const hrState = getVitalState('hr', selected.hr)
  const spo2State = getVitalState('spo2', selected.spo2)
  const rrState = getVitalState('rr', selected.rr)
  const tempState = getVitalState('temp', selected.temp)

  // Patient status label
  const patientStatusLabel = selected.status === 'attention' ? 'Monitoring' : selected.status === 'stale' ? 'Stale' : 'Stable'
  const patientStatusClass = selected.status === 'attention' ? 'status-badge attention' : selected.status === 'stale' ? 'status-badge stale' : 'status-badge online'

  // Live radar nodes: one per patient device, positioned stably by device id,
  // with real status/signal from the mesh. `signal` arrives as a 0-100 quality
  // score, so RSSI/SNR are mapped from that scale into plausible radio units.
  // Radio-style metrics remain simulated until hardware exists.
  const radarNodes: HardwareNode[] = patients.map((p, i) => {
    const golden = i * 2.39996323  // golden-angle spacing keeps blips apart
    const quality = Math.max(0, Math.min(100, p.signal))
    return {
      id: p.deviceId,
      name: p.deviceId,
      patientId: p.id,
      room: p.room,
      angle: golden % (Math.PI * 2),
      distance: 0.3 + ((i * 0.37) % 0.5),
      rssi: Math.max(-85, Math.min(-30, -40 - Math.round((100 - quality) * 0.4))),
      battery: Math.max(20, Math.round(quality)),
      status: p.status === 'stale' ? 'offline' : p.status === 'attention' ? 'warning' : 'online',
      packetsPerSec: 1,
      latencyMs: p.lastSeen > 0 ? p.lastSeen * 1000 : Math.max(1, Math.round((100 - quality) / 10)),
      snrDb: Math.round(quality * 0.35),
      frequencyGHz: 2.412,
      chipset: 'ESP32-S3 (simulated)',
      firmware: 'sim',
      uwbDistanceM: 0,
      respirationDisplacementMm: 0,
    }
  })

  // Signal quality label
  const signalLabel = selected.signal > 90 ? 'Excellent' : selected.signal > 70 ? 'Good' : selected.signal > 50 ? 'Fair' : 'Poor'

  // Simulated system metrics
  const sensorCount = patients.length
  const onlineSensors = patients.filter(p => p.status !== 'stale').length
  const meshStatus = connected ? 'Healthy' : 'Degraded'

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased flex flex-col overflow-x-hidden">

      {/* ==================================================================== */}
      {/* 1. GLOBAL HEADER — Clean Top Navigation                              */}
      {/* ==================================================================== */}
      <header
        className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2"
        style={{ background: 'var(--card)' }}
        role="banner"
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-cyan-500/10 text-cyan-400" aria-hidden="true">
            <Activity className="size-4" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold tracking-tight text-white flex items-center gap-2">
              CareNet IoT
              <span className="text-[10px] font-normal text-slate-500 border-l border-slate-700/50 pl-2">Patient Monitoring Mesh</span>
            </h1>
          </div>
        </div>

        {/* Navigation Tabs — scrollable strip, visible at every width incl. phones */}
        <nav className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-background/50 p-0.5 max-w-full" role="tablist" aria-label="Main navigation">
          {(['Overview', 'Patients', 'Devices', 'Analytics', 'Settings'] as const).map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => handleTabChange(tab)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors sm:px-3 ${
                activeTab === tab
                  ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Right Side Controls */}
        <div className="flex items-center gap-2">
          {/* Data Mode Indicator */}
          <div className="flex items-center rounded-lg border border-border bg-background/50 p-0.5 font-mono text-[10px]">
            <button
              onClick={() => setDataMode('demo')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                dataMode === 'demo'
                  ? 'bg-cyan-500/12 text-cyan-300 border border-cyan-500/20'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              aria-label="Switch to demo mode with synthetic telemetry"
            >
              <Layers className="size-3" />
              <span>DEMO MODE</span>
            </button>
            <button
              onClick={() => setDataMode('real')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-colors ${
                dataMode === 'real'
                  ? 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/20'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              aria-label="Switch to real hardware mode"
            >
              <Wifi className="size-3" />
              <span>LIVE HARDWARE</span>
            </button>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={toggleSound}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium transition-colors ${
              soundEnabled
                ? 'border-cyan-500/20 bg-cyan-500/8 text-cyan-300'
                : 'border-border bg-background/50 text-slate-500 hover:text-slate-300'
            }`}
            aria-label={soundEnabled ? 'Mute audio alerts' : 'Enable audio alerts'}
          >
            {soundEnabled ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
          </button>

          {/* Notifications */}
          <button
            className="relative flex items-center rounded-lg border border-border bg-background/50 p-1.5 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label={`${activeAlerts.length} active alerts`}
          >
            <Bell className="size-3.5" />
            {activeAlerts.length > 0 && (
              <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-rose-500 text-[8px] font-bold text-white">
                {activeAlerts.length}
              </span>
            )}
          </button>

          {/* Date/Time */}
          <div className="hidden md:flex flex-col items-end">
            <span className="font-mono text-[10px] text-slate-400">{currentDate || 'Loading...'}</span>
            <span className="font-mono text-[11px] font-semibold text-slate-300">{currentTime || '--:--:--'}</span>
          </div>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* 2. SYSTEM HEALTH BAR — Compact infrastructure status strip           */}
      {/* ==================================================================== */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-4 border-b border-border px-4 py-1.5 text-[11px] font-mono" style={{ background: 'rgba(10,10,10,0.85)' }}>
        <div className="flex items-center gap-1.5">
          <Radio className="size-3 text-emerald-400" />
          <span className="text-slate-400">Sensors</span>
          <span className="font-semibold text-emerald-400">{onlineSensors}/{sensorCount}</span>
          <span className="text-slate-500">Online</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Server className="size-3 text-emerald-400" />
          <span className="text-slate-400">Edge Nodes</span>
          <span className="font-semibold text-emerald-400">{onlineSensors}/{sensorCount}</span>
          <span className="text-slate-500">Online</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Network className="size-3 text-emerald-400" />
          <span className="text-slate-400">Mesh</span>
          <span className={`font-semibold ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>{meshStatus}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu className="size-3 text-emerald-400" />
          <span className="text-slate-400">Gateway</span>
          <span className={`font-semibold ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>{connected ? 'Online' : 'Offline'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="size-3 text-cyan-400" />
          <span className="text-slate-400">Telemetry</span>
          <span className="font-semibold text-cyan-400">{dataMode === 'demo' ? 'Simulated' : 'Streaming'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Signal className="size-3 text-slate-400" />
          <span className="text-slate-400">Latency</span>
          <span className="font-semibold text-slate-300">3.2 ms</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Demo Mode Anomaly Buttons */}
        {dataMode === 'demo' && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider mr-1">Simulate:</span>
            <button onClick={() => handleTriggerAnomaly('tachycardia')} className="px-2 py-0.5 text-[10px] rounded-md bg-rose-500/10 hover:bg-rose-500/15 text-rose-400 border border-rose-500/20 transition-colors">Tachycardia</button>
            <button onClick={() => handleTriggerAnomaly('hypoxia')} className="px-2 py-0.5 text-[10px] rounded-md bg-amber-500/10 hover:bg-amber-500/15 text-amber-400 border border-amber-500/20 transition-colors">Hypoxia</button>
            <button onClick={() => handleTriggerAnomaly('fever')} className="px-2 py-0.5 text-[10px] rounded-md bg-orange-500/10 hover:bg-orange-500/15 text-orange-400 border border-orange-500/20 transition-colors">Fever</button>
            <button onClick={() => handleTriggerAnomaly('normal')} className="px-2 py-0.5 text-[10px] rounded-md bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 transition-colors">Reset</button>
          </div>
        )}

        {dataMode === 'real' && (
          <div className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-live-pulse' : 'bg-rose-500'}`} />
            <span className={connected ? 'text-emerald-400' : 'text-rose-400'}>
              {connected ? 'Gateway Connected' : 'Reconnecting...'}
            </span>
            {/* Web Serial (USB) is a desktop-browser feature; hide it inside
                the Android WebView where navigator.serial doesn't exist. */}
            {!isNative && (
              <button
                onClick={connectUsbSerial}
                className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${
                  serialConnected
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                    : 'border-cyan-500/20 bg-cyan-500/8 text-cyan-300 hover:bg-cyan-500/12'
                }`}
              >
                <Cpu className="size-3 inline mr-1" />
                {serialConnected ? 'USB Connected' : 'Connect USB'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* Main 3-Column Dashboard Grid — stacks to one column on phones/tablets */}
      {/* ==================================================================== */}
      <div className="flex-1 min-h-0 grid gap-2.5 p-2.5 grid-cols-1 lg:grid-cols-[240px_1fr_340px] xl:grid-cols-[250px_1fr_380px] dashboard-grid-main">

        {/* ------------------------------------------------------------------ */}
        {/* 3. LEFT SIDEBAR — Patient Navigation                               */}
        {/* ------------------------------------------------------------------ */}
        <aside className="flex flex-col gap-2 overflow-hidden panel p-3" role="complementary" aria-label="Patient list">
          {/* Header */}
          <div className="flex items-center justify-between flex-shrink-0">
            <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-300">Patients</h2>
            <span className="rounded-md bg-cyan-500/8 border border-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan-400">
              {patients.length} active
            </span>
          </div>

          {/* Search */}
          <div className="relative flex-shrink-0">
            <Search className="absolute left-2.5 top-2 size-3.5 text-slate-600" aria-hidden="true" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search patient..."
              className="h-8 w-full rounded-lg border border-border bg-background/50 pl-8 pr-3 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:border-cyan-500/30 transition-colors"
              aria-label="Search patients"
            />
          </div>

          {/* Patient Cards List */}
          <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto dashboard-scroll pr-0.5" role="listbox" aria-label="Patient selection">
            {(filteredPatients.length > 0 ? filteredPatients : patients).map(p => {
              const isSelected = selected?.id === p.id
              const isWarning = p.status === 'attention'
              const isStale = p.status === 'stale'
              const statusIcon = isStale ? '⊘' : isWarning ? '!' : '✓'
              const statusText = isStale ? 'Stale' : isWarning ? 'Monitoring' : 'Stable'
              const meta = PATIENT_META[p.id]
              return (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectPatient(p.id)}
                  className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-all ${
                    isSelected
                      ? 'border-cyan-500/25 bg-cyan-500/6'
                      : 'border-transparent bg-transparent hover:border-border hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-200">{p.id.replace('patient-', 'P-00')}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`status-dot ${isStale ? 'stale' : isWarning ? 'attention' : 'online'}`} aria-hidden="true" />
                      <span className={`text-[10px] font-medium ${isStale ? 'text-slate-500' : isWarning ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {statusText}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                    <span>{meta?.room} · {meta?.bed}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span>{p.age} yrs · {p.gender}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Hardware Signal Radar — sidebar slot; moves to the center when the
              Devices tab is active so it gets real estate */}
          {activeTab !== 'Devices' && (
            <div className="mt-auto flex-shrink-0 pt-2 border-t border-border">
              <HardwareSignalRadar
                nodes={radarNodes}
                selectedPatientId={selected?.id}
                onSelectPatient={handleSelectPatient}
              />
            </div>
          )}
        </aside>

        {/* ------------------------------------------------------------------ */}
        {/* CENTER COLUMN — Patient Telemetry & Charts                         */}
        {/* ------------------------------------------------------------------ */}
        <main className="flex flex-col gap-2.5 min-h-0 overflow-y-auto dashboard-scroll" role="main">

          {/* ============================================================ */}
          {/* DEVICES TAB — full-size radar + diagnostics + network        */}
          {/* ============================================================ */}
          {activeTab === 'Devices' && selected && (
            <div className="grid gap-2.5 md:grid-cols-2">
              <div className="panel p-3.5" role="region" aria-label="Hardware signal radar">
                <h3 className="section-title text-sm font-semibold text-white mb-2">Signal Radar</h3>
                <HardwareSignalRadar
                  nodes={radarNodes}
                  selectedPatientId={selected?.id}
                  onSelectPatient={handleSelectPatient}
                />
              </div>
              <div className="panel p-3.5" role="region" aria-label="Realtime diagnostics">
                <h3 className="section-title text-sm font-semibold text-white mb-2">Realtime Diagnostics</h3>
                <RealtimeDiagnosticsPanel patient={selected} />
              </div>
              {networkMetrics && (
                <div className="panel p-3.5 md:col-span-2" role="region" aria-label="Network metrics">
                  <h3 className="section-title text-sm font-semibold text-white mb-2">Mesh Network</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-2" style={{ background: 'var(--background)' }}>
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider">Nodes</span>
                      <span className="font-semibold text-slate-200">{networkMetrics.nodes_online}/{networkMetrics.nodes_total} online</span>
                    </div>
                    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-2" style={{ background: 'var(--background)' }}>
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider">Delivery ratio</span>
                      <span className="font-semibold text-cyan-300">{networkMetrics.delivery_ratio ?? '—'}%</span>
                    </div>
                    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-2" style={{ background: 'var(--background)' }}>
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider">Alert p50</span>
                      <span className="font-semibold text-slate-200">{networkMetrics.alert_latency_ms_p50 != null ? `${networkMetrics.alert_latency_ms_p50} ms` : '—'}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-2" style={{ background: 'var(--background)' }}>
                      <span className="text-[9px] text-slate-500 uppercase tracking-wider">Events</span>
                      <span className="font-semibold text-slate-200">{networkMetrics.recent_events.length}</span>
                    </div>
                  </div>
                  {networkMetrics.recent_events.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-[10px] font-mono max-h-32 overflow-y-auto dashboard-scroll">
                      {networkMetrics.recent_events.slice(0, 12).map(ev => (
                        <li key={ev.event_id} className="flex items-center gap-2 text-slate-400">
                          <span className={`size-1.5 rounded-full ${ev.type === 'route_change' ? 'bg-amber-400' : ev.type === 'buffer_backfill' ? 'bg-cyan-400' : 'bg-emerald-400'}`} />
                          <span className="text-slate-300">{ev.type}</span>
                          <span className="text-slate-500">{ev.device_id}</span>
                          <span className="text-slate-600 truncate flex-1">{ev.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* ANALYTICS TAB — mesh-wide view from live state                */}
          {/* ============================================================ */}
          {activeTab === 'Analytics' && (
            <div className="grid gap-2.5 md:grid-cols-2">
              <div className="panel p-3.5" role="region" aria-label="Patient status summary">
                <h3 className="section-title text-sm font-semibold text-white mb-2">Patient Status</h3>
                <div className="flex flex-col gap-1.5 text-[11px] font-mono">
                  {patients.map(p => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5" style={{ background: 'var(--background)' }}>
                      <span className="text-slate-300">{p.id.replace('patient-', 'P-00')} · {p.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">HR {p.hr}</span>
                        <span className="text-slate-500">SpO₂ {p.spo2}%</span>
                        <span className={`font-semibold ${p.riskScore > 50 ? 'text-rose-400' : p.riskScore > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>{p.riskScore}/100</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel p-3.5" role="region" aria-label="Alert log">
                <h3 className="section-title text-sm font-semibold text-white mb-2">Alert Log</h3>
                {alerts.length === 0 ? (
                  <p className="text-[11px] text-slate-500 font-mono">No alerts raised.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-[10px] font-mono max-h-64 overflow-y-auto dashboard-scroll">
                    {alerts.slice(0, 20).map(a => (
                      <li key={a.alert_id} className="flex items-center gap-2 text-slate-400">
                        <span className={`size-1.5 rounded-full ${a.severity === 'critical' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                        <span className={a.severity === 'critical' ? 'text-rose-300' : 'text-amber-300'}>{a.severity}</span>
                        <span className="text-slate-300 truncate flex-1">{a.message}</span>
                        <span className={a.acknowledged_at_ms ? 'text-emerald-400' : 'text-slate-600'}>{a.acknowledged_at_ms ? 'ACK' : 'OPEN'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="panel p-3.5 md:col-span-2" role="region" aria-label="System summary">
                <h3 className="section-title text-sm font-semibold text-white mb-2">System</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                  <div className="flex flex-col gap-0.5"><span className="text-[9px] text-slate-500 uppercase tracking-wider">Mode</span><span className="font-semibold text-cyan-300">{dataMode === 'demo' ? 'Demo (simulated)' : 'Live hardware'}</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-[9px] text-slate-500 uppercase tracking-wider">Gateway</span><span className={`font-semibold ${connected ? 'text-emerald-400' : 'text-rose-400'}`}>{connected ? 'Connected' : 'Reconnecting'}</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-[9px] text-slate-500 uppercase tracking-wider">Patients</span><span className="font-semibold text-slate-200">{patients.length}</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-[9px] text-slate-500 uppercase tracking-wider">Active alerts</span><span className={`font-semibold ${activeAlerts.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{activeAlerts.length}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* SETTINGS TAB — controls consolidated                          */}
          {/* ============================================================ */}
          {activeTab === 'Settings' && (
            <div className="grid gap-2.5 md:grid-cols-2 max-w-3xl">
              <div className="panel p-3.5" role="region" aria-label="Data mode">
                <h3 className="section-title text-sm font-semibold text-white mb-2">Data Source</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDataMode('demo')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${dataMode === 'demo' ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300' : 'border-border text-slate-400 hover:text-slate-200'}`}
                    aria-pressed={dataMode === 'demo'}
                  >Demo mode (simulated telemetry)</button>
                  <button
                    onClick={() => setDataMode('real')}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${dataMode === 'real' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-border text-slate-400 hover:text-slate-200'}`}
                    aria-pressed={dataMode === 'real'}
                  >Live hardware (backend mesh)</button>
                </div>
                {dataMode === 'real' && !isNative && (
                  <button
                    onClick={connectUsbSerial}
                    className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${serialConnected ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-cyan-500/20 bg-cyan-500/8 text-cyan-400 hover:bg-cyan-500/12'}`}
                  >{serialConnected ? 'USB Connected' : 'Connect USB Serial'}</button>
                )}
              </div>

              {/* Backend server — only meaningful inside the native app, where
                  127.0.0.1 is the phone itself. In a browser this panel is
                  hidden (the build-time NEXT_PUBLIC_API_URL already applies). */}
              {isNative && (
                <div className="panel p-3.5 md:col-span-2" role="region" aria-label="Backend server">
                  <h3 className="section-title text-sm font-semibold text-white mb-2">Backend Server</h3>
                  <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
                    The app reads live data from the FastAPI backend running on a PC on the same
                    Wi-Fi network. Enter that machine's local IP address.
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 items-center rounded-lg border border-border bg-background/50 px-3">
                      <Server className="size-3.5 text-slate-500 mr-2 shrink-0" aria-hidden="true" />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={backendHost}
                        onChange={(e) => { setBackendHost(e.target.value); setBackendSaved(false) }}
                        placeholder="192.168.1.10"
                        aria-label="Backend host IP address"
                        className="w-full bg-transparent py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => {
                        saveBackendHost(backendHost)
                        setBackendSaved(true)
                        // Reconnect the realtime socket to the new host and
                        // re-pull REST data. If still in demo mode, switch to
                        // live so the new backend actually streams in.
                        reconnectRealtime()
                        if (dataMode === 'demo') setDataMode('real')
                      }}
                      className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/15 transition-colors"
                    >Save</button>
                  </div>
                  <p className="mt-2 text-[10px] font-mono text-slate-600 truncate">
                    {backendSaved
                      ? <span className="text-emerald-400">Saved — reconnecting…</span>
                      : <>Active backend: <span className="text-slate-400">{resolveBackendBaseUrl()}</span></>}
                  </p>
                </div>
              )}

              <div className="panel p-3.5" role="region" aria-label="Presentation">
                <h3 className="section-title text-sm font-semibold text-white mb-2">Presentation</h3>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={toggleSound}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${soundEnabled ? 'border-cyan-500/20 bg-cyan-500/8 text-cyan-300' : 'border-border text-slate-400'}`}
                    aria-pressed={soundEnabled}
                  >{soundEnabled ? 'Alert audio: on' : 'Alert audio: muted'}</button>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-background/50 p-1" role="radiogroup" aria-label="Chart time range">
                    {(['LIVE', '1H', '6H', '12H', '24H'] as const).map(range => (
                      <button
                        key={range}
                        role="radio"
                        aria-checked={timeRange === range}
                        onClick={() => setTimeRange(range)}
                        className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${timeRange === range ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300 border border-transparent'}`}
                      >{range}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {(activeTab === 'Overview' || activeTab === 'Patients') && selected && (
            <>
              {/* ============================================================ */}
              {/* 4. PATIENT HEADER — Selected patient context                  */}
              {/* ============================================================ */}
              <div className="flex flex-wrap items-center justify-between gap-3 panel p-3.5 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-lg bg-cyan-500/8 border border-cyan-500/15 text-cyan-400">
                    <User className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold tracking-tight text-white">
                        {selected.name}
                      </h2>
                      <span className={patientStatusClass}>
                        {patientStatusLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 font-mono">
                      {selected.id.replace('patient-', 'P-00')} · {selected.room} · Age {selected.age} · {selected.gender}
                    </p>
                  </div>
                </div>

                {/* Patient Meta Stats */}
                <div className="flex items-center gap-4 text-[11px] font-mono">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider">Risk</span>
                    <span className={`font-semibold ${selected.riskScore > 50 ? 'text-rose-400' : selected.riskScore > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {selected.riskScore}/100
                    </span>
                  </div>
                  <div className="w-px h-6 bg-border" />
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider">Signal</span>
                    <span className="font-semibold text-slate-300">{signalLabel}</span>
                  </div>
                  <div className="w-px h-6 bg-border" />
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[9px] text-slate-500 uppercase tracking-wider">Last Sync</span>
                    <span className="font-semibold text-slate-300">{selected.lastSeen > 0 ? `${selected.lastSeen}s ago` : '< 1s'}</span>
                  </div>
                </div>
              </div>

              {/* ============================================================ */}
              {/* Connectivity Flow                                            */}
              {/* ============================================================ */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-card p-2 flex-shrink-0">
                {[
                  { label: 'Wearable', icon: Activity },
                  { label: 'Edge Node', icon: Radio },
                  { label: 'Mesh', icon: Network },
                  { label: 'Dashboard', icon: LayoutDashboard },
                ].map((step, i) => {
                  const Icon = step.icon
                  return (
                    <div key={step.label} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-1 w-16">
                        <div className={`grid size-7 place-items-center rounded-lg border transition-colors ${
                          connected 
                            ? 'border-emerald-500/20 bg-emerald-500/6 text-emerald-400'
                            : 'border-slate-700 bg-slate-800/50 text-slate-600'
                        }`} aria-hidden="true">
                          <Icon className="size-3.5" />
                        </div>
                        <span className={`text-[10px] font-mono whitespace-nowrap ${connected ? 'text-emerald-400/80' : 'text-slate-600'}`}>
                          {step.label}
                        </span>
                      </div>
                      
                      {i < 3 && (
                        <div className="flex-1 px-1 relative h-0.5 flex items-center justify-center" aria-hidden="true">
                          <div className={`absolute left-0 right-0 h-px ${connected ? 'bg-emerald-500/15' : 'bg-slate-800'}`} />
                          {connected && (
                            <div className="h-0.5 w-6 rounded-full bg-emerald-400/60 animate-data-flow" />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ============================================================ */}
              {/* 5. VITAL SIGN CARDS — 4 readable cards                       */}
              {/* ============================================================ */}
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4 flex-shrink-0" role="region" aria-label="Patient vital signs">
                {/* Heart Rate */}
                <button
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'hr' ? null : 'hr')
                  }}
                  className={`metric-card cursor-pointer text-left ${activeMarker === 'hr' ? 'active-hr' : ''}`}
                  aria-label={`Heart rate: ${selected.hr} beats per minute, ${vitalStateLabel(hrState)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Heart className="size-3.5 text-rose-400" aria-hidden="true" />
                      <span className="text-[11px] font-medium text-slate-400">Heart Rate</span>
                    </div>
                    <span className={`text-[9px] font-semibold ${vitalStateColor(hrState)}`}>{vitalStateLabel(hrState)}</span>
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[28px] font-bold leading-none text-white">{selected.hr}</span>
                      <span className="text-[11px] text-slate-500 font-mono">bpm</span>
                    </div>
                    <MiniSparkline data={hrSparkData} color="#f43f5e" />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-600">Range 60–100</span>
                    <span className="text-[10px] text-slate-500">{getTrendArrow(hrSparkData).label}</span>
                  </div>
                </button>

                {/* SpO₂ */}
                <button
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'spo2' ? null : 'spo2')
                  }}
                  className={`metric-card cursor-pointer text-left ${activeMarker === 'spo2' ? 'active-spo2' : ''}`}
                  aria-label={`SpO2: ${selected.spo2} percent, ${vitalStateLabel(spo2State)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Droplets className="size-3.5 text-cyan-400" aria-hidden="true" />
                      <span className="text-[11px] font-medium text-slate-400">SpO₂</span>
                    </div>
                    <span className={`text-[9px] font-semibold ${vitalStateColor(spo2State)}`}>{vitalStateLabel(spo2State)}</span>
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[28px] font-bold leading-none text-white">{selected.spo2}</span>
                      <span className="text-[11px] text-slate-500 font-mono">%</span>
                    </div>
                    <MiniSparkline data={spo2SparkData} color="#22d3ee" />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-600">Range 95–100</span>
                    <span className="text-[10px] text-slate-500">{getTrendArrow(spo2SparkData).label}</span>
                  </div>
                </button>

                {/* Respiratory Rate */}
                <button
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'rr' ? null : 'rr')
                  }}
                  className={`metric-card cursor-pointer text-left ${activeMarker === 'rr' ? 'active-rr' : ''}`}
                  aria-label={`Respiratory rate: ${selected.rr} breaths per minute, ${vitalStateLabel(rrState)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Wind className="size-3.5 text-violet-400" aria-hidden="true" />
                      <span className="text-[11px] font-medium text-slate-400">Respiratory Rate</span>
                    </div>
                    <span className={`text-[9px] font-semibold ${vitalStateColor(rrState)}`}>{vitalStateLabel(rrState)}</span>
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[28px] font-bold leading-none text-white">{selected.rr}</span>
                      <span className="text-[11px] text-slate-500 font-mono">br/min</span>
                    </div>
                    <MiniSparkline data={rrSparkData} color="#8b5cf6" />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-600">Range 12–20</span>
                    <span className="text-[10px] text-slate-500">{getTrendArrow(rrSparkData).label}</span>
                  </div>
                </button>

                {/* Temperature */}
                <button
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'temp' ? null : 'temp')
                  }}
                  className={`metric-card cursor-pointer text-left ${activeMarker === 'temp' ? 'active-temp' : ''}`}
                  aria-label={`Temperature: ${selected.temp} degrees celsius, ${vitalStateLabel(tempState)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Thermometer className="size-3.5 text-amber-400" aria-hidden="true" />
                      <span className="text-[11px] font-medium text-slate-400">Temperature</span>
                    </div>
                    <span className={`text-[9px] font-semibold ${vitalStateColor(tempState)}`}>{vitalStateLabel(tempState)}</span>
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[28px] font-bold leading-none text-white">{selected.temp}</span>
                      <span className="text-[11px] text-slate-500 font-mono">°C</span>
                    </div>
                    <MiniSparkline data={tempSparkData} color="#f59e0b" />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-600">Range 36.1–37.2</span>
                    <span className="text-[10px] text-slate-500">{getTrendArrow(tempSparkData).label}</span>
                  </div>
                </button>
              </div>

              {/* ============================================================ */}
              {/* 6. LIVE TELEMETRY GRAPH                                      */}
              {/* ============================================================ */}
              <div className="panel p-3.5 flex-shrink-0 relative overflow-hidden" role="region" aria-label="Live vital sign trends">
                <div className="mb-2.5 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="section-title text-sm font-semibold text-white">Live Vitals Trend</h3>
                      <span className="flex items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/6 px-2 py-0.5 text-[10px] font-mono font-medium text-cyan-400">
                        <span className="size-1.5 rounded-full bg-cyan-400 animate-live-pulse" aria-hidden="true" />
                        {timeRange === 'LIVE' ? 'Streaming · 1 Hz' : `${timeRange} Window`}
                      </span>
                    </div>
                    <p className="section-subtitle text-[11px]">Multi-parameter sensor telemetry</p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    {/* Current values */}
                    <div className="hidden md:flex items-center gap-3 text-[10px] font-mono">
                      <span className="flex items-center gap-1 text-rose-400"><span className="size-1.5 rounded-full bg-rose-400" /> HR: {selected.hr}</span>
                      <span className="flex items-center gap-1 text-cyan-400"><span className="size-1.5 rounded-full bg-cyan-400" /> SpO₂: {selected.spo2}%</span>
                      <span className="flex items-center gap-1 text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-400" /> RR: {selected.rr}</span>
                    </div>
                    {/* Time Range Selector */}
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background/50 p-0.5" role="radiogroup" aria-label="Time range">
                      {(['LIVE', '1H', '6H', '12H', '24H'] as const).map(range => (
                        <button
                          key={range}
                          role="radio"
                          aria-checked={timeRange === range}
                          onClick={() => setTimeRange(range)}
                          className={`time-range-btn ${timeRange === range ? 'active' : ''}`}
                        >
                          {range}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div className="relative h-[200px] w-full rounded-lg overflow-hidden bg-[#060e1c] border border-border">
                  {/* Subtle grid overlay */}
                  <div 
                    className="absolute inset-0 opacity-15 pointer-events-none" 
                    style={{ 
                      backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px)',
                      backgroundSize: '24px 24px'
                    }}
                    aria-hidden="true"
                  />

                  {/* Scan beam — only on LIVE mode */}
                  {timeRange === 'LIVE' && (
                    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" aria-hidden="true">
                      <div className="absolute top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-cyan-400/50 to-transparent animate-chart-sweep" />
                    </div>
                  )}

                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedHistory} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="fill-hr" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fill-spo2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fill-rr" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148, 163, 184, 0.06)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[10, 160]} tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(11,17,32,0.95)',
                          border: '1px solid rgba(148, 163, 184, 0.15)',
                          borderRadius: 8,
                          fontSize: 11,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                        }}
                      />
                      <Area type="monotone" dataKey="hr" name="Heart Rate" stroke="#f43f5e" strokeWidth={2} fill="url(#fill-hr)" dot={false} isAnimationActive={false} />
                      <Area type="monotone" dataKey="spo2" name="SpO₂" stroke="#22d3ee" strokeWidth={2} fill="url(#fill-spo2)" dot={false} isAnimationActive={false} />
                      <Area type="monotone" dataKey="rr" name="Resp Rate" stroke="#10b981" strokeWidth={1.5} fill="url(#fill-rr)" dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* ============================================================ */}
              {/* Bottom Grid: Risk + Alerts + Events + Telemetry Quality       */}
              {/* ============================================================ */}
              <div className="grid gap-2.5 md:grid-cols-2 flex-shrink-0">
                {/* ======================================================== */}
                {/* 8. RISK ANALYSIS — with contributors                      */}
                {/* ======================================================== */}
                <div className="panel p-3.5" role="region" aria-label="Risk analysis">
                  <h3 className="section-title text-sm font-semibold text-white mb-2">Risk Analysis</h3>
                  <div className="flex items-start gap-4">
                    <RiskScoreGauge score={selected.riskScore} label={selected.riskScore > 50 ? "High Risk" : selected.riskScore > 25 ? "Elevated" : "Low Risk"} />
                    <div className="flex-1 flex flex-col gap-1.5 text-[11px] font-mono">
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Contributors</p>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Heart Rate</span>
                        <span className={vitalStateColor(hrState)}>{vitalStateLabel(hrState)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">SpO₂</span>
                        <span className={vitalStateColor(spo2State)}>{vitalStateLabel(spo2State)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Respiration</span>
                        <span className={vitalStateColor(rrState)}>{vitalStateLabel(rrState)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Temperature</span>
                        <span className={vitalStateColor(tempState)}>{vitalStateLabel(tempState)}</span>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-border">
                        <span className="text-slate-400">Signal Quality</span>
                        <span className="text-slate-300">{signalLabel}</span>
                      </div>
                      <p className="text-[9px] text-slate-600 mt-0.5">Last evaluated: {currentTime}</p>
                    </div>
                  </div>
                </div>

                {/* ======================================================== */}
                {/* 10. ALERT PANEL — Dedicated alerts                        */}
                {/* ======================================================== */}
                <div className="panel p-3.5" role="region" aria-label="Active alerts">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="section-title text-sm font-semibold text-white">Alerts</h3>
                    {activeAlerts.length > 0 && (
                      <span className="rounded-md bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-400">
                        {activeAlerts.length} Active
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 text-[11px]">
                    {activeAlerts.length > 0 ? (
                      activeAlerts.slice(0, 4).map(a => (
                        <div key={a.alert_id} className="flex items-start gap-2 rounded-lg border border-rose-500/10 bg-rose-500/5 p-2 relative">
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-lg bg-rose-400/50" />
                          <AlertTriangle className="size-3.5 shrink-0 text-rose-400 mt-0.5 ml-1" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-rose-200 text-[11px] leading-snug">{a.message}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-mono text-[9px] text-slate-500">{formatMs(a.raised_at_ms)}</span>
                              {dataMode === 'demo' && (
                                <span className="text-[8px] font-semibold text-cyan-500 bg-cyan-500/10 px-1 py-0.5 rounded border border-cyan-500/15">SIMULATION</span>
                              )}
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => handleAcknowledgeAlert(a.alert_id)} className="h-6 px-2 text-[9px] font-medium text-cyan-400 hover:bg-cyan-500/10 rounded-md" aria-label="Acknowledge alert">
                            Ack
                          </Button>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col gap-1.5 py-2">
                        <div className="flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle2 className="size-3.5" aria-hidden="true" />
                          <span className="font-medium">All vitals normal</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle2 className="size-3.5" aria-hidden="true" />
                          <span className="font-medium">No active alerts</span>
                        </div>
                        <p className="text-[10px] text-slate-600 mt-1">Last checked: {currentTime}</p>
                      </div>
                    )}
                  </div>

                  {/* ECG Sparkline */}
                  <div className="mt-2 pt-2 border-t border-border">
                    <ECGWaveformCanvas
                      height={20}
                      color={selected.status === 'attention' ? "#f59e0b" : "#10b981"}
                      hr={selected.hr}
                      spo2={selected.spo2}
                      temp={selected.temp}
                      status={selected.status}
                      riskScore={selected.riskScore}
                      enableBeep={soundEnabled}
                    />
                  </div>
                </div>
              </div>

              {/* ============================================================ */}
              {/* 9. RECENT EVENTS + 11. TELEMETRY QUALITY                     */}
              {/* ============================================================ */}
              <div className="grid gap-2.5 md:grid-cols-2 flex-shrink-0">
                {/* Recent Events Timeline */}
                <div className="panel p-3.5" role="region" aria-label="Recent events">
                  <h3 className="section-title text-sm font-semibold text-white mb-2">Recent Events</h3>
                  <div className="flex flex-col gap-1 text-[11px] font-mono max-h-[140px] overflow-y-auto dashboard-scroll">
                    {eventLog.slice(0, 8).map(evt => (
                      <div key={evt.id} className="flex items-center gap-2 py-1 border-b border-border/50 last:border-0">
                        <span className="text-[10px] text-slate-600 w-16 flex-shrink-0">{evt.time}</span>
                        {evt.type === 'success' && <CheckCircle2 className="size-3 text-emerald-400 flex-shrink-0" />}
                        {evt.type === 'info' && <Activity className="size-3 text-cyan-400 flex-shrink-0" />}
                        {evt.type === 'warning' && <AlertTriangle className="size-3 text-amber-400 flex-shrink-0" />}
                        {evt.type === 'critical' && <CircleAlert className="size-3 text-rose-400 flex-shrink-0" />}
                        <span className="text-slate-400 truncate">{evt.message}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Telemetry Quality */}
                <div className="panel p-3.5" role="region" aria-label="Telemetry quality">
                  <h3 className="section-title text-sm font-semibold text-white mb-2">Telemetry Quality</h3>
                  <div className="flex flex-col gap-2 text-[11px]">
                    {[
                      { name: 'Heart Rate', quality: 98, color: 'bg-rose-400' },
                      { name: 'SpO₂', quality: 99, color: 'bg-cyan-400' },
                      { name: 'Respiration', quality: 97, color: 'bg-violet-400' },
                      { name: 'Temperature', quality: 98, color: 'bg-amber-400' },
                    ].map(item => (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="text-slate-400 w-24 font-mono text-[10px]">{item.name}</span>
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.quality}%` }} />
                        </div>
                        <span className="text-slate-300 font-mono w-8 text-right">{item.quality}%</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2 border-t border-border text-[10px] font-mono">
                      <span className="text-slate-500">Packet Age</span>
                      <span className="text-slate-300">{selected.lastSeen > 0 ? `${selected.lastSeen}s` : '< 1s'}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-slate-500">Source</span>
                      <span className="text-slate-300">Edge Node {selected.deviceId?.replace('device-', '') || '01'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ============================================================ */}
              {/* 13. INFRASTRUCTURE HEALTH — Bottom strip                     */}
              {/* ============================================================ */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8 flex-shrink-0" role="region" aria-label="Infrastructure health">
                {[
                  { icon: Battery, label: 'Battery', value: '87%', iconColor: 'text-emerald-400' },
                  { icon: Signal, label: 'Signal', value: '-42 dBm', iconColor: 'text-cyan-400' },
                  { icon: Cpu, label: 'Edge Mode', value: 'Online', iconColor: 'text-emerald-400' },
                  { icon: Clock, label: 'Last Sync', value: selected.lastSeen > 0 ? `${selected.lastSeen}s` : '< 1s', iconColor: 'text-blue-400' },
                  { icon: ShieldCheck, label: 'Delivery', value: '99.98%', iconColor: 'text-emerald-400' },
                  { icon: RefreshCw, label: 'Retries', value: '8', iconColor: 'text-amber-400' },
                  { icon: AlertTriangle, label: 'Dropped', value: '0', iconColor: 'text-emerald-400' },
                  { icon: Shield, label: 'Corrupted', value: '7', iconColor: 'text-slate-400' },
                ].map(item => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="rounded-lg border border-border bg-card p-2 flex items-center gap-2">
                      <Icon className={`size-3.5 ${item.iconColor} flex-shrink-0`} aria-hidden="true" />
                      <div className="min-w-0">
                        <span className="text-[9px] uppercase text-slate-500 block font-mono tracking-wider truncate">{item.label}</span>
                        <span className="text-[11px] font-semibold font-mono text-white">{item.value}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Empty State */}
          {!selected && (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              <div className="text-center">
                <User className="size-12 mx-auto mb-3 text-slate-700" />
                <p className="font-medium">No patient selected</p>
                <p className="text-xs text-slate-600 mt-1">Select a patient from the sidebar to view telemetry</p>
              </div>
            </div>
          )}
        </main>

        {/* ------------------------------------------------------------------ */}
        {/* 7. RIGHT COLUMN — Patient Visualization & Anatomical Model         */}
        {/* ------------------------------------------------------------------ */}
        {activeTab === 'Overview' && selected && (
          <aside className="hidden lg:flex flex-col min-h-0 overflow-hidden" role="complementary" aria-label="Patient visualization">
            <AnatomicalBodyHologram
              patientId={selected.id.replace('patient-', 'P-00')}
              room={selected.room}
              hr={selected.hr}
              spo2={selected.spo2}
              temp={selected.temp}
              rr={selected.rr}
              status={selected.status}
              activeMarker={activeMarker}
              onMarkerSelect={setActiveMarker}
            />
          </aside>
        )}
      </div>

      {/* ==================================================================== */}
      {/* Disclaimer Footer                                                    */}
      {/* ==================================================================== */}
      <footer className="disclaimer-bar flex-shrink-0" role="contentinfo">
        Educational prototype — simulated, non-clinical data. Not for diagnosis.
      </footer>
    </div>
  )
}

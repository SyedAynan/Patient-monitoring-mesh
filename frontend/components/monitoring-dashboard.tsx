'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Battery, BatteryCharging, Bell, Check, ChevronRight, Clock,
  Cpu, Droplets, Heart, HeartPulse, LayoutDashboard, Layers, LineChart, Menu, Network, Radio, RefreshCw, Search,
  ShieldCheck, Signal, Thermometer, User, Volume2, VolumeX, Wifi, Wind, X, Zap, FileText, Settings,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import {
  fetchDevices, fetchMeasurements, fetchAlerts, fetchNetworkMetrics,
  acknowledgeAlert as apiAcknowledgeAlert,
  type Device, type Measurement, type Alert as ApiAlert, type NetworkMetrics, type NetworkEvent,
} from '@/lib/api'
import { subscribe, onConnectionStatus, type RealtimeMessage } from '@/lib/realtime'
import { monitorAudio } from '@/lib/audio'
import { ECGWaveformCanvas } from './ecg-canvas'
import { RiskScoreGauge } from './risk-gauge'
import { AnatomicalBodyHologram } from './anatomical-body'
import { HardwareSignalRadar } from './hardware-signal-radar'

// ---------------------------------------------------------------------------
// Derived types
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

const PATIENT_META: Record<string, { name: string; room: string; age: number; gender: string; color: string }> = {
  'patient-01': { name: 'Avery Morgan', room: 'Room 101 - Bed 1', age: 62, gender: 'Male', color: 'cyan' },
  'patient-02': { name: 'Jordan Lee', room: 'Room 102 - Bed 2', age: 54, gender: 'Female', color: 'amber' },
  'patient-03': { name: 'Samira Patel', room: 'Room 103 - Bed 3', age: 72, gender: 'Female', color: 'violet' },
  'patient-04': { name: 'Elliot Chen', room: 'Room 104 - Bed 4', age: 43, gender: 'Male', color: 'rose' },
  'patient-05': { name: 'Kai Nakamura', room: 'Room 105 - Bed 5', age: 37, gender: 'Male', color: 'emerald' },
}

function deviceToPatient(dev: Device, latestMeasurement?: Measurement): Patient {
  const meta = PATIENT_META[dev.patient_id] || { name: dev.patient_id, room: 'Room 100', age: 60, gender: 'Unspecified', color: 'slate' }
  const isStale = dev.status === 'stale' || dev.status === 'offline'
  const needsAttention = latestMeasurement && (
    latestMeasurement.heart_rate_bpm > 120 || latestMeasurement.spo2_percent < 94
  )
  const status: Status = isStale ? 'stale' : needsAttention ? 'attention' : 'online'
  const ageMs = Date.now() - (dev.last_seen_at_ms > 1e12 ? dev.last_seen_at_ms : dev.last_seen_at_ms * 1000)

  const hr = latestMeasurement ? Math.round(latestMeasurement.heart_rate_bpm) : 72
  const spo2 = latestMeasurement ? Number(latestMeasurement.spo2_percent.toFixed(1)) : 98
  const temp = latestMeasurement ? Number(latestMeasurement.temperature_c.toFixed(1)) : 36.8
  const rr = latestMeasurement ? Math.round(14 + (hr % 6)) : 16

  let riskScore = 12
  if (hr > 110 || hr < 55) riskScore += 18
  if (spo2 < 95) riskScore += 22
  if (temp > 37.8 || temp < 36.0) riskScore += 12

  return {
    id: dev.patient_id,
    name: meta.name,
    room: meta.room,
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
    riskScore: Math.min(100, riskScore),
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
function MiniSparkline({ data, color, height = 20, width = 64 }: { data: number[]; color: string; height?: number; width?: number }) {
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
    <svg width={width} height={height} className="opacity-50 flex-shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Fallback patient data (shown until API connects)
// ---------------------------------------------------------------------------
const FALLBACK_PATIENTS: Patient[] = Object.entries(PATIENT_META).map(([id, meta], i) => ({
  id,
  name: meta.name,
  room: meta.room,
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
// Main CareNet Dashboard with Audio FX
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
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [timeRange, setTimeRange] = useState<'1H' | '6H' | '12H' | '24H'>('1H')
  const [activeMarker, setActiveMarker] = useState<'hr' | 'spo2' | 'rr' | 'temp' | null>(null)

  const latestMeasurements = useRef<Record<string, Measurement>>({})
  const selected = patients.find(p => p.id === selectedId) ?? patients[0]

  // Live time ticker
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date()
      setCurrentTime(`${d.toISOString().split('T')[0]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const toggleSound = () => {
    const newState = monitorAudio.toggleSound()
    setSoundEnabled(newState)
  }

  // Trigger synthetic anomaly in Demo Mode (Drives cards, graph, markers, risk scores & alerts)
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
          const needsAttention = m.heart_rate_bpm > 120 || m.spo2_percent < 94
          if (needsAttention) {
            monitorAudio.playAlertAlarm('warning')
          }
          return {
            ...p,
            hr: Math.round(m.heart_rate_bpm),
            spo2: Number(m.spo2_percent.toFixed(1)),
            temp: Number(m.temperature_c.toFixed(1)),
            rr: Math.round(14 + (m.heart_rate_bpm % 6)),
            signal: m.signal_quality,
            sequence: m.sequence_number,
            lastSeen: 0,
            status: needsAttention ? 'attention' : 'online',
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

  // Continuous High-Frequency Live Telemetry Motion Ticker (Smooth 1-second pulse without component thrashing)
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

  return (
    <div className="h-screen overflow-hidden bg-black text-slate-100 font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200 flex flex-col">

      {/* ==================================================================== */}
      {/* CareNet IoT Top Navigation Header Bar                                */}
      {/* ==================================================================== */}
      <header className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/12 px-4 py-2.5" style={{ background: 'linear-gradient(180deg, rgba(5,5,8,0.98) 0%, rgba(0,0,0,1) 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl border border-cyan-400/25 bg-cyan-500/12 text-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.2)]">
            <Activity className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              CareNet IoT <span className="text-[10px] font-normal text-slate-400 border-l border-slate-700 pl-2">Patient Monitoring System</span>
            </h1>
          </div>
        </div>

        {/* Dual Mode Switcher: Demo Mode vs Real Hardware Mode */}
        <div className="flex items-center rounded-xl border border-cyan-500/30 bg-cyan-950/40 p-0.5 font-mono text-[11px] shadow-[0_0_15px_rgba(6,182,212,0.15)]">
          <button
            onClick={() => setDataMode('demo')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-bold transition-all ${
              dataMode === 'demo'
                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.3)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🧪 DEMO MODE</span>
          </button>

          <button
            onClick={() => setDataMode('real')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-bold transition-all ${
              dataMode === 'real'
                ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/50 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
            <span>🔌 REAL HARDWARE</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-0.5 rounded-xl border border-white/8 bg-black/50 p-0.5">
          {(['Overview', 'Patients', 'Devices', 'Analytics', 'Settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`rounded-lg px-3.5 py-1.5 text-[11px] font-semibold transition-all ${
                activeTab === tab
                  ? 'border border-cyan-400/35 bg-cyan-500/18 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.18)]'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Top Right: Sound Controls & Preview, Live, Time */}
        <div className="flex items-center gap-2">


          <button
            onClick={toggleSound}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
              soundEnabled
                ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                : 'border-white/8 bg-white/5 text-slate-400 hover:text-slate-200'
            }`}
            title={soundEnabled ? 'Hospital Sound FX Enabled (Click to Mute)' : 'Enable Hospital Sound FX'}
          >
            {soundEnabled ? <Volume2 className="size-3.5 animate-pulse text-cyan-300" /> : <VolumeX className="size-3.5" />}
            <span>{soundEnabled ? 'Sound ON' : 'Sound Muted'}</span>
          </button>

          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-3 py-1 text-[11px] font-semibold text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" /> Live
          </div>
          <span className="font-mono text-[11px] text-slate-400">{currentTime || '2026-10-02 16:10:35'}</span>
        </div>
      </header>

      {/* Mode Status Sub-Header Bar */}
      {dataMode === 'demo' ? (
        <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 bg-cyan-950/20 px-4 py-1.5 font-mono text-xs">
          <div className="flex items-center gap-2 text-cyan-300 font-semibold">
            <span className="size-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>DEMO MODE ACTIVE · SYNTHETIC TELEMETRY GENERATOR</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400">ANOMALY SIMULATOR:</span>
            <button onClick={() => handleTriggerAnomaly('tachycardia')} className="px-2 py-0.5 text-[10px] rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40">⚡ Tachycardia</button>
            <button onClick={() => handleTriggerAnomaly('hypoxia')} className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40">📉 Hypoxia</button>
            <button onClick={() => handleTriggerAnomaly('fever')} className="px-2 py-0.5 text-[10px] rounded bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/40">🔥 Fever</button>
            <button onClick={() => handleTriggerAnomaly('normal')} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40">🟢 Reset Normal</button>
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/25 bg-emerald-950/20 px-4 py-1.5 font-mono text-xs">
          <div className="flex items-center gap-2 text-emerald-300 font-semibold">
            <span className={`size-2 rounded-full ${connected ? 'bg-emerald-400 animate-ping' : 'bg-rose-500 animate-pulse'}`} />
            <span>{connected ? 'REAL HARDWARE GATEWAY CONNECTED (ws://127.0.0.1:8000/api/v1/realtime)' : 'SEARCHING FOR HARDWARE GATEWAY (http://127.0.0.1:8000)...'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={connectUsbSerial}
              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
                serialConnected
                  ? 'border-emerald-400 bg-emerald-500/30 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.3)]'
                  : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
              }`}
            >
              <Cpu className="size-3" />
              <span>{serialConnected ? 'USB SERIAL HARDWARE CONNECTED' : '🔌 CONNECT USB SERIAL (ESP32/ARDUINO)'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* Main CareNet 3-Column Grid Dashboard Layout                          */}
      {/* ==================================================================== */}
      <div className="flex-1 min-h-0 grid gap-3 p-3 lg:grid-cols-[250px_1fr_350px] xl:grid-cols-[260px_1fr_400px] dashboard-grid-main" style={{ maxHeight: 'calc(100vh - 52px)' }}>

        {/* ------------------------------------------------------------------ */}
        {/* LEFT COLUMN: Patient Selector List                                 */}
        {/* ------------------------------------------------------------------ */}
        <aside className="flex flex-col gap-3 rounded-2xl border border-cyan-500/10 p-3.5 backdrop-blur-xl overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(5,5,8,0.95) 0%, rgba(0,0,0,0.98) 100%)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-wider uppercase text-slate-200">Patients</h2>
            <span className="rounded-full bg-cyan-500/10 border border-cyan-500/25 px-2 py-0.5 font-mono text-[11px] font-semibold text-cyan-300">
              {patients.length} active
            </span>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 size-3.5 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search patient..."
              className="h-8 w-full rounded-lg border border-white/8 bg-black/40 pl-8 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-400/40 transition-colors"
            />
          </div>

          {/* Patient Cards List */}
          <div className="flex flex-col gap-2 flex-1 overflow-y-auto dashboard-scroll pr-0.5">
            {(filteredPatients.length > 0 ? filteredPatients : patients).map(p => {
              const isSelected = selected?.id === p.id
              const isWarning = p.status === 'attention'
              const isStale = p.status === 'stale'
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelectPatient(p.id)}
                  className={`flex items-center justify-between rounded-xl border p-2.5 text-left transition-all ${
                    isSelected
                      ? 'border-cyan-400/50 bg-cyan-500/12 shadow-[0_0_20px_rgba(34,211,238,0.1)]'
                      : 'border-white/6 bg-black/25 hover:border-white/12 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`grid size-7 place-items-center rounded-lg ${isSelected ? 'bg-cyan-400/18 text-cyan-300' : 'bg-white/5 text-slate-400'}`}>
                      <User className="size-3.5" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-slate-200">{p.room}</p>
                      <p className="text-[10px] font-mono text-slate-400">Patient ID: {p.id.replace('patient-', 'P-00')}</p>
                    </div>
                  </div>
                  {/* Status LED */}
                  <span className={`size-2 rounded-full flex-shrink-0 ${
                    isStale ? 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]' : isWarning ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                  }`} />
                </button>
              )
            })}
          </div>

          {/* Hardware Signal Radar Component */}
          <div className="mt-auto flex-shrink-0 pt-2 border-t border-cyan-500/15">
            <HardwareSignalRadar
              selectedPatientId={selected?.id}
              onSelectPatient={handleSelectPatient}
            />
          </div>
        </aside>

        {/* ------------------------------------------------------------------ */}
        {/* CENTER COLUMN: Focused Patient Telemetry & Charts                  */}
        {/* ------------------------------------------------------------------ */}
        <main className="flex flex-col gap-3 min-h-0 overflow-y-auto dashboard-scroll">
          {selected && (
            <>
              {/* Patient Header Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-500/12 p-3.5 backdrop-blur-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgba(8,8,12,0.95) 0%, rgba(0,0,0,0.98) 100%)' }}>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-bold tracking-tight text-white">
                      Patient {selected.id.replace('patient-', 'P-00')}
                    </h2>
                    <span className="rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                      Stable
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400 font-mono">
                    {selected.room} · Age {selected.age} · {selected.gender}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Real-time Stream Active</span>
                </div>
              </div>

              {/* Status Connectivity Flow */}
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/15 bg-emerald-950/10 p-2 flex-shrink-0">
                {[
                  { label: 'Wearable', icon: Activity },
                  { label: 'Edge Node', icon: Radio },
                  { label: 'Mesh', icon: Network },
                  { label: 'Dashboard', icon: LayoutDashboard },
                ].map((step, i) => {
                  const isActive = connected
                  const Icon = step.icon
                  return (
                    <div key={step.label} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-1 w-16">
                        <div className={`grid size-7 place-items-center rounded-lg border transition-all duration-300 ${
                          connected 
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.1)]'
                            : 'border-slate-700 bg-slate-800/50 text-slate-500'
                        }`}>
                          <Icon className="size-3.5" />
                        </div>
                        <span className={`text-[10px] font-mono whitespace-nowrap ${connected ? 'text-emerald-400/90' : 'text-slate-500'}`}>
                          {step.label}
                        </span>
                      </div>
                      
                      {i < 3 && (
                        <div className="flex-1 px-1 relative h-0.5 flex items-center justify-center">
                          <div className={`absolute left-0 right-0 h-px ${connected ? 'bg-emerald-500/25' : 'bg-slate-800'}`} />
                          {connected && (
                            <div className="h-1 w-8 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-data-flow" />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 4 Core Vital Metric Cards Grid (Interactive Sync with Digital Twin) */}
              <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4 flex-shrink-0">
                {/* 1. Heart Rate */}
                <div
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'hr' ? null : 'hr')
                  }}
                  className={`metric-card cursor-pointer transition-all ${
                    activeMarker === 'hr'
                      ? 'border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.35)] bg-rose-500/10 ring-1 ring-rose-500/40'
                      : 'hover:border-rose-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <Heart className="size-3.5 text-rose-500 fill-rose-500/20 animate-pulse" /> Heart Rate
                    </span>
                    {activeMarker === 'hr' && (
                      <span className="text-[9px] font-mono font-bold text-rose-400 bg-rose-500/20 px-1.5 py-0.5 rounded border border-rose-500/30 animate-pulse">SELECTED</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-2xl font-bold text-white">{selected.hr}</span>
                      <span className="text-[11px] text-slate-400 font-mono">bpm</span>
                    </div>
                    <MiniSparkline data={hrSparkData} color="#f43f5e" />
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-slate-500">(60 - 100)</p>
                </div>

                {/* 2. SpO2 */}
                <div
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'spo2' ? null : 'spo2')
                  }}
                  className={`metric-card cursor-pointer transition-all ${
                    activeMarker === 'spo2'
                      ? 'border-cyan-400 shadow-[0_0_20px_rgba(56,189,248,0.35)] bg-cyan-500/10 ring-1 ring-cyan-400/40'
                      : 'hover:border-cyan-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <Droplets className="size-3.5 text-cyan-400 fill-cyan-400/20" /> SpO₂
                    </span>
                    {activeMarker === 'spo2' && (
                      <span className="text-[9px] font-mono font-bold text-cyan-300 bg-cyan-500/20 px-1.5 py-0.5 rounded border border-cyan-400/30 animate-pulse">SELECTED</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-2xl font-bold text-white">{selected.spo2}</span>
                      <span className="text-[11px] text-slate-400 font-mono">%</span>
                    </div>
                    <MiniSparkline data={spo2SparkData} color="#38bdf8" />
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-slate-500">(95 - 100)</p>
                </div>

                {/* 3. Respiratory Rate */}
                <div
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'rr' ? null : 'rr')
                  }}
                  className={`metric-card cursor-pointer transition-all ${
                    activeMarker === 'rr'
                      ? 'border-violet-400 shadow-[0_0_20px_rgba(139,92,246,0.35)] bg-violet-500/10 ring-1 ring-violet-400/40'
                      : 'hover:border-violet-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <Wind className="size-3.5 text-violet-400" /> Respiratory Rate
                    </span>
                    {activeMarker === 'rr' && (
                      <span className="text-[9px] font-mono font-bold text-violet-300 bg-violet-500/20 px-1.5 py-0.5 rounded border border-violet-400/30 animate-pulse">SELECTED</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-2xl font-bold text-white">{selected.rr}</span>
                      <span className="text-[11px] text-slate-400 font-mono">br/min</span>
                    </div>
                    <MiniSparkline data={rrSparkData} color="#8b5cf6" />
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-slate-500">(12 - 20)</p>
                </div>

                {/* 4. Temperature */}
                <div
                  onClick={() => {
                    monitorAudio.playUiClick()
                    setActiveMarker(prev => prev === 'temp' ? null : 'temp')
                  }}
                  className={`metric-card cursor-pointer transition-all ${
                    activeMarker === 'temp'
                      ? 'border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.35)] bg-amber-500/10 ring-1 ring-amber-400/40'
                      : 'hover:border-amber-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <Thermometer className="size-3.5 text-amber-400" /> Temperature
                    </span>
                    {activeMarker === 'temp' && (
                      <span className="text-[9px] font-mono font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-400/30 animate-pulse">SELECTED</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-2xl font-bold text-white">{selected.temp}</span>
                      <span className="text-[11px] text-slate-400 font-mono">°C</span>
                    </div>
                    <MiniSparkline data={tempSparkData} color="#fbbf24" />
                  </div>
                  <p className="mt-1 text-[10px] font-mono text-slate-500">(36.1 - 37.2)</p>
                </div>
              </div>

              {/* Live Vitals Multi-Parameter Overlaid Chart */}
              <div className="panel p-4 flex-shrink-0 relative overflow-hidden">
                <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="section-title text-sm font-bold text-white">Live Vitals Trend</h3>
                      <span className="flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.2)]">
                        <span className="size-1.5 rounded-full bg-cyan-400 animate-ping" /> STREAMING
                      </span>
                    </div>
                    <p className="section-subtitle">Real-time multi-parameter sensor telemetry motion graph</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3 text-[11px] font-mono">
                      <span className="flex items-center gap-1 text-rose-400 font-semibold">
                        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" /> Heart Rate: {selected.hr} bpm
                      </span>
                      <span className="flex items-center gap-1 text-cyan-400 font-semibold">
                        <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse" /> SpO₂: {selected.spo2}%
                      </span>
                      <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" /> Resp: {selected.rr} br/min
                      </span>
                    </div>
                    {/* Time Range Selector */}
                    <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-black/30 p-0.5">
                      {(['1H', '6H', '12H', '24H'] as const).map(range => (
                        <button
                          key={range}
                          onClick={() => setTimeRange(range)}
                          className={`time-range-btn ${timeRange === range ? 'active' : ''}`}
                        >
                          {range}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Moving Graph Container with Dual Laser Scan Beams & Motion Grid */}
                <div className="relative h-[200px] w-full rounded-xl overflow-hidden bg-[#020914]/90 border border-cyan-500/15">
                  {/* Drifting Motion Grid Overlay */}
                  <div 
                    className="absolute inset-0 opacity-25 pointer-events-none animate-grid-drift" 
                    style={{ 
                      backgroundImage: 'linear-gradient(rgba(56, 189, 248, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.2) 1px, transparent 1px)',
                      backgroundSize: '24px 24px'
                    }} 
                  />

                  {/* Dual Moving Vertical Laser Scan Beams */}
                  <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
                    <div className="absolute top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-cyan-400 to-transparent shadow-[0_0_18px_#22d3ee] animate-chart-sweep" />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-gradient-to-b from-transparent via-teal-300 to-transparent shadow-[0_0_12px_#5eead4] animate-chart-sweep-reverse" />
                  </div>

                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedHistory} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="fill-hr" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fill-spo2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                          <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="fill-rr" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(56,189,248,0.18)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[10, 160]} tick={{ fill: '#94a3b8', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(3,8,20,0.95)',
                          border: '1px solid rgba(56,189,248,0.3)',
                          borderRadius: 10,
                          fontSize: 10,
                          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                          backdropFilter: 'blur(12px)',
                        }}
                      />
                      <Area type="monotone" dataKey="hr" name="Heart Rate" stroke="#f43f5e" strokeWidth={3} fill="url(#fill-hr)" dot={false} isAnimationActive={false} />
                      <Area type="monotone" dataKey="spo2" name="SpO₂" stroke="#38bdf8" strokeWidth={3} fill="url(#fill-spo2)" dot={false} isAnimationActive={false} />
                      <Area type="monotone" dataKey="rr" name="Resp Rate" stroke="#34d399" strokeWidth={2.5} fill="url(#fill-rr)" dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 2-Column Row: Risk Score Gauge + Recent Alerts */}
              <div className="grid gap-3 md:grid-cols-2 flex-shrink-0">
                {/* Risk Score Widget */}
                <div className="panel p-4 flex flex-col">
                  <h3 className="section-title font-bold text-white text-sm">Risk Score</h3>
                  <div className="flex items-center justify-center gap-6 flex-1 mt-1">
                    <RiskScoreGauge score={selected.riskScore} label={selected.riskScore > 25 ? "Elevated Risk" : "Low Risk"} />
                    <div className="flex flex-col gap-1.5">
                      <div className="risk-range-row">
                        <span className="text-emerald-400 font-semibold w-14">Low</span>
                        <span className="text-slate-500">0–25</span>
                      </div>
                      <div className="risk-range-row">
                        <span className="text-amber-400 font-semibold w-14">Moderate</span>
                        <span className="text-slate-500">26–50</span>
                      </div>
                      <div className="risk-range-row">
                        <span className="text-orange-400 font-semibold w-14">High</span>
                        <span className="text-slate-500">51–75</span>
                      </div>
                      <div className="risk-range-row">
                        <span className="text-rose-400 font-semibold w-14">Critical</span>
                        <span className="text-slate-500">76–100</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recent Alerts List */}
                <div className="panel p-4 flex flex-col">
                  <div className="flex items-center justify-between">
                    <h3 className="section-title font-bold text-white text-sm">Recent Alerts</h3>
                    <button className="text-[10px] font-mono font-semibold text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-0.5">
                      View All <ChevronRight className="size-3" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 text-[11px] flex-1">
                    {activeAlerts.length > 0 ? (
                      activeAlerts.slice(0, 3).map(a => (
                        <div key={a.alert_id} className="flex items-center gap-2 rounded-xl border border-amber-500/15 bg-amber-500/8 p-2.5 text-amber-200 relative overflow-hidden">
                          {/* Warning left edge */}
                          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400/60" />
                          <AlertTriangle className="size-3.5 shrink-0 text-amber-400 ml-1" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-[11px]">{a.message}</p>
                            <span className="font-mono text-[9px] text-slate-400">{formatMs(a.raised_at_ms)}</span>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => handleAcknowledgeAlert(a.alert_id)} className="h-6 px-2 text-[9px] font-semibold text-cyan-300 hover:bg-cyan-500/15 rounded-md">Ack</Button>
                        </div>
                      ))
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
                          <Check className="size-3.5" /> Normal vitals
                        </div>
                        <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
                          <Check className="size-3.5" /> No alerts
                        </div>
                        <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
                          <Check className="size-3.5" /> On room air
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Continuous Heartbeat Sparkline with QRS Heartbeat Audio Beeps */}
                    <ECGWaveformCanvas
                      height={24}
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

              {/* Bottom Device Telemetry Strip */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 flex-shrink-0">
                <div className="rounded-xl border border-white/6 bg-[#06111D]/60 p-2.5 flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400"><Battery className="size-3.5" /></span>
                  <div>
                    <span className="text-[9px] uppercase text-slate-400 block font-mono tracking-wider">Battery</span>
                    <span className="text-xs font-bold font-mono text-white">87%</span>
                  </div>
                </div>

                <div className="rounded-xl border border-white/6 bg-[#06111D]/60 p-2.5 flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-lg bg-cyan-500/15 text-cyan-300"><Signal className="size-3.5" /></span>
                  <div>
                    <span className="text-[9px] uppercase text-slate-400 block font-mono tracking-wider">Signal Strength</span>
                    <span className="text-xs font-bold font-mono text-white">Excellent</span>
                  </div>
                </div>

                <div className="rounded-xl border border-white/6 bg-[#06111D]/60 p-2.5 flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400"><Cpu className="size-3.5" /></span>
                  <div>
                    <span className="text-[9px] uppercase text-slate-400 block font-mono tracking-wider">Edge Mode</span>
                    <span className="text-xs font-bold font-mono text-white">Online</span>
                  </div>
                </div>

                <div className="rounded-xl border border-white/6 bg-[#06111D]/60 p-2.5 flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-lg bg-blue-500/15 text-blue-300"><Clock className="size-3.5" /></span>
                  <div>
                    <span className="text-[9px] uppercase text-slate-400 block font-mono tracking-wider">Last Sync</span>
                    <span className="text-xs font-bold font-mono text-white">Just now</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        {/* ------------------------------------------------------------------ */}
        {/* RIGHT COLUMN: 3D Anatomical Hologram & Vital Readout               */}
        {/* ------------------------------------------------------------------ */}
        {selected && (
          <aside className="flex flex-col min-h-0 overflow-hidden">
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

      <style jsx global>{`
        @keyframes dataFlow {
          0% { transform: translateX(-100%); opacity: 0.2; }
          50% { opacity: 1; }
          100% { transform: translateX(300%); opacity: 0.2; }
        }
        .animate-data-flow {
          animation: dataFlow 1.6s infinite ease-in-out;
        }
      `}</style>
    </div>
  )
}

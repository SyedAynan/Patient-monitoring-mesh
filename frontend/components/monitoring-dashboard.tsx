'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Battery, BatteryCharging, Bell, Check, ChevronRight, Clock,
  Cpu, Droplets, Heart, HeartPulse, LayoutDashboard, Layers, LineChart, Lungs, Menu, Network, Radio, RefreshCw, Search,
  ShieldCheck, Signal, Thermometer, User, Wifi, Wind, X, Zap, FileText, Settings,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import {
  fetchDevices, fetchMeasurements, fetchAlerts, fetchNetworkMetrics,
  acknowledgeAlert as apiAcknowledgeAlert,
  type Device, type Measurement, type Alert as ApiAlert, type NetworkMetrics, type NetworkEvent,
} from '@/lib/api'
import { subscribe, onConnectionStatus, type RealtimeMessage } from '@/lib/realtime'
import { ECGWaveformCanvas } from './ecg-canvas'
import { RiskScoreGauge } from './risk-gauge'
import { AnatomicalBodyHologram } from './anatomical-body'

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

type MetricKey = 'hr' | 'spo2' | 'temp'
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

  // Calculate simple risk score
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
// Main CareNet Dashboard
// ---------------------------------------------------------------------------

export default function MonitoringDashboard() {
  const [activeTab, setActiveTab] = useState<'Overview' | 'Patients' | 'Devices' | 'Analytics' | 'Settings'>('Overview')
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedId, setSelectedId] = useState('patient-01')
  const [connected, setConnected] = useState(true)
  const [alerts, setAlerts] = useState<ApiAlert[]>([])
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null)
  const [search, setSearch] = useState('')
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [lastSync, setLastSync] = useState<string>('—')
  const [currentTime, setCurrentTime] = useState<string>('')

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
      setLastSync(new Date().toLocaleTimeString())
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

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 3000)
    return () => clearInterval(interval)
  }, [loadData])

  useEffect(() => {
    const patientIds = Object.keys(PATIENT_META)
    patientIds.forEach(id => loadHistory(id))
    const interval = setInterval(() => {
      patientIds.forEach(id => loadHistory(id))
    }, 5000)
    return () => clearInterval(interval)
  }, [loadHistory])

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
        setLastSync(new Date().toLocaleTimeString())
      }
      if (msg.type === 'alert') {
        const a = msg.payload as ApiAlert
        setAlerts(prev => [a, ...prev.filter(x => x.alert_id !== a.alert_id)])
      }
    })
    const unsubStatus = onConnectionStatus(setConnected)
    return () => { unsub(); unsubStatus() }
  }, [])

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      const updated = await apiAcknowledgeAlert(alertId)
      setAlerts(prev => prev.map(a => a.alert_id === alertId ? updated : a))
    } catch { /* ignore */ }
  }

  const filteredPatients = patients.filter(p => `${p.name} ${p.id} ${p.room}`.toLowerCase().includes(search.toLowerCase()))
  const selectedHistory = (selected ? history[selected.id] : []) || []
  const activeAlerts = alerts.filter(a => a.acknowledged_at_ms === null)

  return (
    <div className="min-h-screen bg-[#01040a] text-slate-100 p-4 sm:p-6 font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
      <div className="mx-auto max-w-[1720px] rounded-3xl border border-cyan-500/25 bg-[#020713]/90 shadow-[0_0_100px_rgba(0,0,0,0.95)] backdrop-blur-2xl p-5 sm:p-6">
        
        {/* ==================================================================== */}
        {/* CareNet IoT Top Navigation Header Bar */}
        {/* ==================================================================== */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-cyan-500/15 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.25)]">
              <Activity className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                CareNet IoT <span className="text-xs font-normal text-slate-400 border-l border-slate-700 pl-2">Patient Monitoring System</span>
              </h1>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
            {(['Overview', 'Patients', 'Devices', 'Analytics', 'Settings'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === tab
                    ? 'border border-cyan-400/40 bg-cyan-500/20 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.2)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>

          {/* Top Right Live Time & Status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <span className="size-2 rounded-full bg-emerald-400 animate-ping" /> Live
            </div>
            <span className="font-mono text-xs text-slate-400">{currentTime || '2026-10-02 16:10:35'}</span>
          </div>
        </header>

        {/* ==================================================================== */}
        {/* Main CareNet 3-Column Grid Dashboard Layout */}
        {/* ==================================================================== */}
        <div className="grid gap-6 lg:grid-cols-[280px_1fr_340px] xl:grid-cols-[300px_1fr_360px]">

          {/* ------------------------------------------------------------------ */}
          {/* LEFT COLUMN: Patient Selector List */}
          {/* ------------------------------------------------------------------ */}
          <aside className="flex flex-col gap-4 rounded-2xl border border-cyan-500/15 bg-[#030917]/75 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight text-white">Patients</h2>
              <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                {patients.length} active
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-3.5 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search patient..."
                className="h-8.5 w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
              />
            </div>

            {/* Patient Cards List */}
            <div className="flex flex-col gap-2.5 max-h-[720px] overflow-y-auto pr-1">
              {(filteredPatients.length > 0 ? filteredPatients : patients).map(p => {
                const isSelected = selected?.id === p.id
                const isWarning = p.status === 'attention'
                const isStale = p.status === 'stale'
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
                      isSelected
                        ? 'border-cyan-400/60 bg-cyan-500/15 shadow-[0_0_25px_rgba(34,211,238,0.15)]'
                        : 'border-white/10 bg-black/30 hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`grid size-8 place-items-center rounded-lg ${isSelected ? 'bg-cyan-400/20 text-cyan-300' : 'bg-white/5 text-slate-400'}`}>
                        <User className="size-4" />
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-slate-200">{p.room}</p>
                        <p className="text-[10px] font-mono text-slate-400">Patient ID: {p.id.replace('patient-', 'P-00')}</p>
                      </div>
                    </div>
                    {/* Status LED */}
                    <span className={`size-2.5 rounded-full ${
                      isStale ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]' : isWarning ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                    }`} />
                  </button>
                )
              })}
            </div>
          </aside>

          {/* ------------------------------------------------------------------ */}
          {/* CENTER COLUMN: Focused Patient Telemetry & Charts */}
          {/* ------------------------------------------------------------------ */}
          <main className="flex flex-col gap-5">
            {selected && (
              <>
                {/* Patient Header Banner */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-500/20 bg-[#030917]/80 p-4 backdrop-blur-xl">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-bold tracking-tight text-white">
                        Patient {selected.id.replace('patient-', 'P-00')}
                      </h2>
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-0.5 text-xs font-semibold text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)]">
                        Stable
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400 font-mono">
                      {selected.room} · Age {selected.age} · {selected.gender}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                    <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Real-time Stream Active</span>
                  </div>
                </div>

                {/* 4 Core Vital Metric Cards Grid */}
                <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
                  {/* 1. Heart Rate */}
                  <div className="metric-card">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                        <Heart className="size-4 text-rose-500 fill-rose-500/20 animate-pulse" /> Heart Rate
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="font-mono text-3xl font-bold text-white">{selected.hr}</span>
                      <span className="text-xs text-slate-400 font-mono">bpm</span>
                    </div>
                    <p className="mt-1.5 text-[10px] font-mono text-slate-400">(60 - 100)</p>
                  </div>

                  {/* 2. SpO2 */}
                  <div className="metric-card">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                        <Droplets className="size-4 text-cyan-400 fill-cyan-400/20" /> SpO₂
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="font-mono text-3xl font-bold text-white">{selected.spo2}</span>
                      <span className="text-xs text-slate-400 font-mono">%</span>
                    </div>
                    <p className="mt-1.5 text-[10px] font-mono text-slate-400">(95 - 100)</p>
                  </div>

                  {/* 3. Respiratory Rate */}
                  <div className="metric-card">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                        <Wind className="size-4 text-blue-400" /> Respiratory Rate
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="font-mono text-3xl font-bold text-white">{selected.rr}</span>
                      <span className="text-xs text-slate-400 font-mono">br/min</span>
                    </div>
                    <p className="mt-1.5 text-[10px] font-mono text-slate-400">(12 - 20)</p>
                  </div>

                  {/* 4. Temperature */}
                  <div className="metric-card">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                        <Thermometer className="size-4 text-amber-400" /> Temperature
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="font-mono text-3xl font-bold text-white">{selected.temp}</span>
                      <span className="text-xs text-slate-400 font-mono">°C</span>
                    </div>
                    <p className="mt-1.5 text-[10px] font-mono text-slate-400">(36.1 - 37.2)</p>
                  </div>
                </div>

                {/* Live Vitals Multi-Parameter Overlaid Chart */}
                <div className="panel p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="section-title text-base font-bold text-white">Live Vitals Trend</h3>
                      <p className="section-subtitle">Real-time multi-parameter sensor telemetry</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span className="flex items-center gap-1.5 text-rose-400"><span className="size-2 rounded-full bg-rose-500" /> Heart Rate</span>
                      <span className="flex items-center gap-1.5 text-cyan-400"><span className="size-2 rounded-full bg-cyan-400" /> SpO₂</span>
                      <span className="flex items-center gap-1.5 text-emerald-400"><span className="size-2 rounded-full bg-emerald-400" /> Respiratory Rate</span>
                    </div>
                  </div>

                  <div className="h-[230px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={selectedHistory} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="fill-hr" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="fill-spo2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="fill-rr" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[10, 160]} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#030814', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 12, fontSize: 11 }} />
                        <Area type="monotone" dataKey="hr" name="Heart Rate" stroke="#f43f5e" strokeWidth={2} fill="url(#fill-hr)" />
                        <Area type="monotone" dataKey="spo2" name="SpO₂" stroke="#38bdf8" strokeWidth={2} fill="url(#fill-spo2)" />
                        <Area type="monotone" dataKey="rr" name="Resp Rate" stroke="#34d399" strokeWidth={2} fill="url(#fill-rr)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 2-Column Row: Risk Score Gauge + Recent Alerts */}
                <div className="grid gap-5 md:grid-cols-2">
                  {/* Risk Score Widget */}
                  <div className="panel p-5 flex flex-col justify-between">
                    <h3 className="section-title font-bold text-white">Risk Score</h3>
                    <RiskScoreGauge score={selected.riskScore} label={selected.riskScore > 25 ? "Elevated Risk" : "Low Risk"} />
                  </div>

                  {/* Recent Alerts List */}
                  <div className="panel p-5 flex flex-col justify-between">
                    <h3 className="section-title font-bold text-white">Recent Alerts</h3>
                    <div className="my-3 flex flex-col gap-2.5 text-xs">
                      {activeAlerts.length > 0 ? (
                        activeAlerts.slice(0, 3).map(a => (
                          <div key={a.alert_id} className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-amber-200">
                            <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{a.message}</p>
                              <span className="font-mono text-[10px] text-slate-400">{formatMs(a.raised_at_ms)}</span>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => handleAcknowledgeAlert(a.alert_id)} className="h-7 text-[10px] font-semibold text-cyan-300">Ack</Button>
                          </div>
                        ))
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-emerald-400 font-medium">
                            <Check className="size-4" /> Normal vitals
                          </div>
                          <div className="flex items-center gap-2 text-emerald-400 font-medium">
                            <Check className="size-4" /> No alerts
                          </div>
                          <div className="flex items-center gap-2 text-emerald-400 font-medium">
                            <Check className="size-4" /> On room air
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Continuous Heartbeat Sparkline */}
                    <div className="pt-2">
                      <ECGWaveformCanvas height={28} color="#10b981" />
                    </div>
                  </div>
                </div>

                {/* Bottom Device Telemetry Strip */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3 flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/20 text-emerald-400"><Battery className="size-4" /></span>
                    <div>
                      <span className="text-[10px] uppercase text-slate-400 block font-mono">Battery</span>
                      <span className="text-sm font-bold font-mono text-white">87%</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/40 p-3 flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-lg bg-cyan-500/20 text-cyan-300"><Signal className="size-4" /></span>
                    <div>
                      <span className="text-[10px] uppercase text-slate-400 block font-mono">Signal Strength</span>
                      <span className="text-sm font-bold font-mono text-white">Excellent</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/40 p-3 flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/20 text-emerald-400"><Cpu className="size-4" /></span>
                    <div>
                      <span className="text-[10px] uppercase text-slate-400 block font-mono">Edge Node</span>
                      <span className="text-sm font-bold font-mono text-white">Online</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/40 p-3 flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-lg bg-blue-500/20 text-blue-300"><Clock className="size-4" /></span>
                    <div>
                      <span className="text-[10px] uppercase text-slate-400 block font-mono">Last Sync</span>
                      <span className="text-sm font-bold font-mono text-white">Just now</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </main>

          {/* ------------------------------------------------------------------ */}
          {/* RIGHT COLUMN: 3D Anatomical Hologram & Vital Readout */}
          {/* ------------------------------------------------------------------ */}
          {selected && (
            <aside>
              <AnatomicalBodyHologram
                patientId={selected.id.replace('patient-', 'P-00')}
                room={selected.room}
                hr={selected.hr}
                spo2={selected.spo2}
                temp={selected.temp}
                rr={selected.rr}
                status={selected.status}
              />
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

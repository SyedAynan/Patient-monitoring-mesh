'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Check, ChevronRight, Circle,
  Clock3, Cpu, Gauge, HeartPulse, LayoutDashboard, Menu, Network, Radio, RefreshCw, Search,
  Server, Settings2, ShieldCheck, Signal, Sparkles, Thermometer, Wifi, X, Zap, FileText,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import * as THREE from 'three'
import { Button } from '@/components/ui/button'
import {
  fetchDevices, fetchMeasurements, fetchAlerts, fetchNetworkMetrics,
  acknowledgeAlert as apiAcknowledgeAlert,
  type Device, type Measurement, type Alert as ApiAlert, type NetworkMetrics, type NetworkEvent,
} from '@/lib/api'
import { subscribe, onConnectionStatus, type RealtimeMessage } from '@/lib/realtime'

// ---------------------------------------------------------------------------
// Derived types for the UI
// ---------------------------------------------------------------------------

type Status = 'online' | 'attention' | 'stale'
type Patient = {
  id: string; name: string; room: string; age: number; status: Status;
  hr: number; spo2: number; temp: number; signal: number; lastSeen: number;
  sequence: number; color: string; deviceId: string;
}
type MetricKey = 'hr' | 'spo2' | 'temp'
type HistoryPoint = { time: string; hr: number; spo2: number; temp: number }

const PATIENT_META: Record<string, { name: string; room: string; age: number; color: string }> = {
  'patient-01': { name: 'Avery Morgan', room: 'Sector A · 04', age: 68, color: 'cyan' },
  'patient-02': { name: 'Jordan Lee', room: 'Sector A · 07', age: 54, color: 'amber' },
  'patient-03': { name: 'Samira Patel', room: 'Sector B · 02', age: 72, color: 'violet' },
  'patient-04': { name: 'Elliot Chen', room: 'Sector B · 06', age: 43, color: 'rose' },
  'patient-05': { name: 'Kai Nakamura', room: 'Sector C · 01', age: 37, color: 'emerald' },
}

const navItems = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Patients', icon: HeartPulse },
  { label: 'Network', icon: Network }, { label: 'Alerts', icon: Bell }, { label: 'Rounds', icon: Clock3 }, { label: 'Reports', icon: FileText }, { label: 'Settings', icon: Settings2 },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deviceToPatient(dev: Device, latestMeasurement?: Measurement): Patient {
  const meta = PATIENT_META[dev.patient_id] || { name: dev.patient_id, room: 'Unknown', age: 0, color: 'slate' }
  const isStale = dev.status === 'stale' || dev.status === 'offline'
  const needsAttention = latestMeasurement && (
    latestMeasurement.heart_rate_bpm > 120 || latestMeasurement.spo2_percent < 94
  )
  const status: Status = isStale ? 'stale' : needsAttention ? 'attention' : 'online'
  const ageMs = Date.now() - (dev.last_seen_at_ms > 1e12 ? dev.last_seen_at_ms / 1 : dev.last_seen_at_ms)
  return {
    id: dev.patient_id,
    name: meta.name,
    room: meta.room,
    age: meta.age,
    status,
    hr: latestMeasurement ? Math.round(latestMeasurement.heart_rate_bpm) : 0,
    spo2: latestMeasurement ? Number(latestMeasurement.spo2_percent.toFixed(1)) : 0,
    temp: latestMeasurement ? Number(latestMeasurement.temperature_c.toFixed(1)) : 0,
    signal: dev.signal_quality,
    lastSeen: isStale ? Math.round(ageMs / 1000) : 0,
    sequence: latestMeasurement?.sequence_number ?? 0,
    color: meta.color,
    deviceId: dev.device_id,
  }
}

function formatTimeAgo(seconds: number) { return seconds === 0 ? 'just now' : `${seconds}s ago` }

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
  }))
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Status }) {
  const config = {
    online: ['Online', 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]'],
    attention: ['Needs attention', 'text-amber-300 bg-amber-500/10 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.2)]'],
    stale: ['Stale signal', 'text-rose-300 bg-rose-500/10 border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.2)]']
  }[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${config[1]}`}>
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {config[0]}
    </span>
  )
}

function Metric({ icon: Icon, label, value, unit, tone = 'cyan', trend }: { icon: typeof Activity; label: string; value: string | number; unit: string; tone?: string; trend?: string }) {
  return (
    <div className="metric-card">
      <div className="flex items-center justify-between">
        <span className={`metric-icon ${tone}`}><Icon /></span>
        {trend && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-300"><ArrowUpRight />{trend}</span>}
      </div>
      <div className="mt-4 flex items-end gap-1">
        <span className="font-mono text-2xl font-bold tracking-tight text-white">{value}</span>
        <span className="mb-1 text-xs text-slate-400">{unit}</span>
      </div>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}

function PatientCard({ patient, selected, onSelect }: { patient: Patient; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`group w-full rounded-2xl border p-4 text-left backdrop-blur-xl transition-all duration-300 ${
        selected
          ? 'border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_35px_rgba(34,211,238,0.15)]'
          : 'border-white/10 bg-black/40 hover:border-cyan-500/30 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid size-9 shrink-0 place-items-center rounded-xl bg-${patient.color}-400/15 text-${patient.color}-300 shadow-[0_0_15px_rgba(56,189,248,0.15)]`}>
            <HeartPulse />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">{patient.name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">{patient.id} · {patient.room}</p>
          </div>
        </div>
        <StatusBadge status={patient.status} />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Heart rate</p>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-100">{patient.hr}<span className="ml-1 text-[10px] font-normal text-slate-400">bpm</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">SpO₂</p>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-100">{patient.spo2}<span className="ml-1 text-[10px] font-normal text-slate-400">%</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Freshness</p>
          <p className={`mt-1 font-mono text-sm font-medium ${patient.status === 'stale' ? 'text-rose-300' : 'text-slate-200'}`}>{formatTimeAgo(patient.lastSeen)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-[10px] text-slate-400">
        <span className="flex items-center gap-1.5"><Signal /> Signal {Math.round(patient.signal * 100)}%</span>
        <span className="flex items-center gap-1 font-medium text-cyan-300 opacity-0 transition-opacity group-hover:opacity-100">Inspect <ChevronRight /></span>
      </div>
    </button>
  )
}

function TrendChart({ history, metric }: { history: HistoryPoint[]; metric: MetricKey }) {
  const config = {
    hr: { label: 'Heart rate', unit: 'bpm', color: '#38d9ef', domain: [50, 170] },
    spo2: { label: 'SpO₂ saturation', unit: '%', color: '#c084fc', domain: [90, 100] },
    temp: { label: 'Temperature', unit: '°C', color: '#fef08a', domain: [35.5, 38.5] }
  }[metric]

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={config.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={config.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis domain={config.domain} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#030814', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 12, fontSize: 11, color: '#f0f6fc' }} labelStyle={{ color: '#94a3b8' }} formatter={(value) => [`${value} ${config.unit}`, config.label]} />
          <Area type="monotone" dataKey={metric} stroke={config.color} strokeWidth={2.5} fill={`url(#fill-${metric})`} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function RoundsPage({ patients, onBack }: { patients: Patient[]; onBack: () => void }) {
  const [completed, setCompleted] = useState<string[]>([])
  const toggle = (id: string) => setCompleted((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const tasks = patients.map((patient, index) => ({ id: patient.id, patient, task: index === 0 ? 'Review overnight vitals' : index === 1 ? 'Escalate elevated heart rate' : index === 2 ? 'Confirm medication response' : index === 3 ? 'Reconnect bedside sensor' : 'Check signal quality', due: index === 1 ? 'Priority · now' : `${index + 1}0 min` }))
  return (
    <div className="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <button onClick={onBack} className="mb-6 flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-cyan-300">
          <ChevronRight className="rotate-180" />Back to overview
        </button>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">Deep Space Ops / Rounds</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Clinical Handoff Queue</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">Focused care queue for telemetry shift transitions.</p>
          </div>
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 backdrop-blur-xl">
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Progress</p>
            <p className="mt-1 font-mono text-lg font-bold text-cyan-200">{completed.length}/{tasks.length} complete</p>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
          <section className="panel p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Current Review Queue</h2>
                <p className="mt-1 text-xs text-slate-400">Prioritized from telemetry freshness and clinical urgency.</p>
              </div>
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[10px] font-semibold text-amber-300 border border-amber-500/30">{tasks.length - completed.length} open</span>
            </div>
            <div className="flex flex-col gap-3">
              {tasks.map(({ id, patient, task, due }) => {
                const done = completed.includes(id)
                return (
                  <button key={id} onClick={() => toggle(id)} className={`flex items-center gap-4 rounded-xl border p-4 text-left backdrop-blur-xl transition ${done ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/10 bg-black/40 hover:border-cyan-400/30'}`}>
                    <span className={`grid size-8 shrink-0 place-items-center rounded-full border ${done ? 'border-emerald-400/40 bg-emerald-400/20 text-emerald-300' : 'border-white/20 text-transparent'}`}><Check /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{task}</span>
                      <span className="mt-1 block text-[11px] text-slate-400">{patient.name} · {patient.room}</span>
                    </span>
                    <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${due.startsWith('Priority') ? 'text-amber-300' : 'text-slate-400'}`}>{due}</span>
                  </button>
                )
              })}
            </div>
          </section>
          <aside className="flex flex-col gap-5">
            <div className="panel border-amber-500/20 bg-amber-500/5 p-5">
              <div className="flex items-center gap-2 text-amber-300"><AlertTriangle /><h2 className="text-sm font-semibold">Priority Clinical Watch</h2></div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{patients.find(p => p.status === 'attention')?.name || 'No patient'} requires immediate attention.</p>
              <button onClick={() => { const attn = patients.find(p => p.status === 'attention'); if (attn) toggle(attn.id) }} className="mt-4 rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30">Mark Reviewed</button>
            </div>
            <div className="panel p-5">
              <h2 className="text-sm font-semibold text-white">Shift Notes</h2>
              <textarea aria-label="Rounding notes" placeholder="Record shift handoff notes..." className="mt-4 min-h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-400/50" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function ReportsPage({ patients, networkMetrics, onBack }: { patients: Patient[]; networkMetrics: NetworkMetrics | null; onBack: () => void }) {
  const [range, setRange] = useState('24h')
  const [exported, setExported] = useState(false)
  const attention = patients.filter((patient) => patient.status !== 'online').length
  const averageSignal = Math.round(patients.reduce((sum, patient) => sum + patient.signal, 0) / Math.max(1, patients.length) * 100)
  const reportRows = [
    { label: 'Telemetry coverage', value: networkMetrics ? `${networkMetrics.delivery_ratio ?? '—'}%` : '—', detail: 'Based on gateway delivery ratio', tone: 'text-emerald-300' },
    { label: 'Nodes online', value: networkMetrics ? `${networkMetrics.nodes_online}/${networkMetrics.nodes_total}` : '—', detail: 'Actively reporting devices', tone: 'text-cyan-300' },
    { label: 'Signal reliability', value: `${averageSignal}%`, detail: `Across ${patients.length} bedside sensors`, tone: 'text-violet-300' },
    { label: 'Escalations', value: `${attention}`, detail: attention ? 'Requires clinical review' : 'No open escalations', tone: attention ? 'text-amber-300' : 'text-emerald-300' },
  ]
  return (
    <div className="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <button onClick={onBack} className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-cyan-300"><ChevronRight className="rotate-180" />Back to overview</button>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">Deep Space Ops / Reports</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Operations Performance</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Telemetry quality, mesh routing performance, and system metrics.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-white/10 bg-black/40 p-1">{['24h', '7d', '30d'].map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${range === item ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}>{item}</button>)}</div>
            <button onClick={() => setExported(true)} className="flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20"><FileText />{exported ? 'Report ready' : 'Export report'}</button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {reportRows.map((row) => (
            <div key={row.label} className="panel p-5">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">{row.label}</p>
              <p className={`mt-4 font-mono text-3xl font-bold ${row.tone}`}>{row.value}</p>
              <p className="mt-2 text-xs text-slate-400">{row.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SettingsPage({ onBack }: { onBack: () => void }) {
  const [saved, setSaved] = useState(false)
  const [notifications, setNotifications] = useState(true)
  const [autoEscalate, setAutoEscalate] = useState(true)
  const [quietHours, setQuietHours] = useState(false)
  const preferences = [
    { label: 'Critical telemetry notifications', detail: 'Push alerts when a patient crosses a safety threshold.', value: notifications, setValue: setNotifications },
    { label: 'Automatic escalation routing', detail: 'Route unacknowledged alerts to the charge nurse after 5 minutes.', value: autoEscalate, setValue: setAutoEscalate },
    { label: 'Quiet hours', detail: 'Suppress non-critical notifications during the configured night shift.', value: quietHours, setValue: setQuietHours },
  ]
  return (
    <div className="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8">
      <div className="mx-auto max-w-5xl">
        <button onClick={onBack} className="mb-6 flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-cyan-300"><ChevronRight className="rotate-180" />Back to overview</button>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">Deep Space Ops / Settings</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">System Settings</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Configure safety thresholds, alert escalation, and mesh telemetry behavior.</p>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <section className="panel p-5">
            <h2 className="text-sm font-semibold text-white">Alert Preferences</h2>
            <div className="mt-4 flex flex-col gap-3">
              {preferences.map((pref) => (
                <div key={pref.label} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/40 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{pref.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{pref.detail}</p>
                  </div>
                  <button onClick={() => pref.setValue(!pref.value)} className={`relative h-6 w-11 shrink-0 rounded-full border transition ${pref.value ? 'border-cyan-400/40 bg-cyan-500/20' : 'border-white/10 bg-white/5'}`}>
                    <span className={`absolute top-1 size-4 rounded-full transition ${pref.value ? 'left-6 bg-cyan-300' : 'left-1 bg-slate-500'}`} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3D Space Mesh Visualizer Component
// ---------------------------------------------------------------------------

function SpaceStarParticles() {
  const pointsRef = useRef<THREE.Points>(null)
  const count = 400
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16
      pos[i * 3 + 1] = (Math.random() - 0.5) * 16
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16
    }
    return pos
  }, [count])

  useFrame(({ clock }) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = clock.elapsedTime * 0.02
      pointsRef.current.rotation.x = clock.elapsedTime * 0.01
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.035} color="#e0f2fe" transparent opacity={0.65} />
    </points>
  )
}

function PulseNode({ patient, index }: { patient: Patient; index: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const angle = (index * Math.PI * 2) / 5
  const position: [number, number, number] = [Math.cos(angle) * 2.3, Math.sin(angle) * 1.2, Math.sin(angle) * 1.3]

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2.5 + index) * 0.1)
    }
  })

  const color = patient.status === 'attention' ? '#fbbf24' : patient.status === 'stale' ? '#fb7185' : '#38d9ef'

  return (
    <group position={position}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.24, 32, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} roughness={0.1} />
      </mesh>
      <Text position={[0, 0.44, 0]} fontSize={0.11} color="#f0f6fc" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#000000">
        {patient.name}
      </Text>
      <Text position={[0, 0.28, 0]} fontSize={0.08} color="#94a3b8" anchorX="center" anchorY="middle">
        {`${Math.round(patient.signal * 100)}% signal`}
      </Text>
    </group>
  )
}

function NetworkPulsePanel({ patients }: { patients: Patient[] }) {
  const links = patients.map((_, index) => (
    <line key={index}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[
            new Float32Array([
              0, 0, 0,
              Math.cos((index * Math.PI * 2) / patients.length) * 2.3,
              Math.sin((index * Math.PI * 2) / patients.length) * 1.2,
              Math.sin((index * Math.PI * 2) / patients.length) * 1.3,
            ]),
            3,
          ]}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#38d9ef" transparent opacity={0.4} />
    </line>
  ))

  return (
    <section className="network-pulse mb-6 overflow-hidden rounded-2xl border border-cyan-400/30 bg-black/80 shadow-[0_0_80px_rgba(34,211,238,0.12),0_25px_80px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 via-transparent to-purple-500/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="size-2.5 animate-ping rounded-full bg-cyan-400" />
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="size-4 text-cyan-300" /> 3D Space Mesh Topology
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">Orbit the ward spatial network to inspect active node signal links.</p>
          </div>
        </div>
        <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 font-mono text-[10px] font-semibold text-cyan-200">
          {patients.length} nodes · 1 gateway
        </span>
      </div>
      <div className="h-[380px] w-full bg-[#000000]">
        <Canvas camera={{ position: [0, 1.4, 7.0], fov: 42 }} dpr={[1, 2]}>
          <color attach="background" args={['#000000']} />
          <ambientLight intensity={0.8} />
          <pointLight position={[0, 3, 5]} intensity={20} color="#38d9ef" />
          <SpaceStarParticles />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, 0]}>
            <ringGeometry args={[2.0, 2.35, 64]} />
            <meshBasicMaterial color="#38d9ef" transparent opacity={0.25} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.45, 32, 32]} />
            <meshStandardMaterial color="#c084fc" emissive="#9333ea" emissiveIntensity={2.0} />
          </mesh>
          {links}
          {patients.map((patient, index) => (
            <PulseNode key={patient.id} patient={patient} index={index} />
          ))}
          <OrbitControls enablePan={false} minDistance={4.5} maxDistance={9.5} />
        </Canvas>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------

export default function MonitoringDashboard() {
  const [active, setActive] = useState('Overview')
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedId, setSelectedId] = useState('patient-01')
  const [metric, setMetric] = useState<MetricKey>('hr')
  const [connected, setConnected] = useState(true)
  const [alerts, setAlerts] = useState<ApiAlert[]>([])
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics | null>(null)
  const [networkEvents, setNetworkEvents] = useState<NetworkEvent[]>([])
  const [search, setSearch] = useState('')
  const [briefOpen, setBriefOpen] = useState(false)
  const [handoffCopied, setHandoffCopied] = useState(false)
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [lastSync, setLastSync] = useState<string>('—')

  const latestMeasurements = useRef<Record<string, Measurement>>({})
  const selected = patients.find(p => p.id === selectedId) ?? patients[0]

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
      setNetworkEvents(netRes.recent_events || [])
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
      if (msg.type === 'device_status') {
        const d = msg.payload as Device
        setPatients(prev => prev.map(p => {
          if (p.deviceId !== d.device_id) return p
          return { ...p, status: d.status === 'stale' ? 'stale' : p.status, signal: d.signal_quality }
        }))
      }
      if (msg.type === 'network_event') {
        const e = msg.payload as NetworkEvent
        setNetworkEvents(prev => [e, ...prev].slice(0, 20))
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
  const onlineCount = patients.filter(p => p.status !== 'stale').length
  const attentionCount = patients.filter(p => p.status !== 'online').length
  const activeAlerts = alerts.filter(a => a.acknowledged_at_ms === null)
  const selectedHistory = history[selectedId] || []

  const Sidebar = () => (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[240px] border-r border-cyan-500/15 bg-black/80 backdrop-blur-2xl lg:block">
      <div className="flex h-full flex-col p-5">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-cyan-400/15 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
            <Activity />
          </span>
          <div>
            <p className="font-bold tracking-tight text-white text-base">MESH<span className="text-cyan-300">/</span>SPACE</p>
            <p className="text-[9px] uppercase tracking-widest text-slate-400">Deep Telemetry</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1.5">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => setActive(label)}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs font-medium transition-all ${
                active === label
                  ? 'border border-cyan-400/30 bg-cyan-500/15 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.15)]'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <Icon className="size-4" />
              {label}
              {label === 'Alerts' && activeAlerts.length > 0 && (
                <span className="ml-auto rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  {activeAlerts.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4 backdrop-blur-xl">
          <p className="text-[10px] uppercase tracking-widest text-slate-400">Ward Coverage</p>
          <p className="mt-2 font-mono text-xl font-bold text-white">{onlineCount}/{patients.length}</p>
          <p className="mt-1 text-[10px] font-medium text-emerald-300 flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" /> Devices synchronized
          </p>
        </div>
      </div>
    </aside>
  )

  if (active === 'Reports') return <><Sidebar /><ReportsPage patients={patients} networkMetrics={networkMetrics} onBack={() => setActive('Overview')} /></>
  if (active === 'Settings') return <><Sidebar /><SettingsPage onBack={() => setActive('Overview')} /></>
  if (active === 'Rounds') return <><Sidebar /><RoundsPage patients={patients} onBack={() => setActive('Overview')} /></>

  if (active === 'Patients' || active === 'Network' || active === 'Alerts') {
    const isPatients = active === 'Patients'
    const isNetwork = active === 'Network'
    const title = isPatients ? 'Patient Directory' : isNetwork ? 'Network Telemetry' : 'Alert Console'
    const description = isPatients ? 'Complete real-time monitoring streams for all connected patient nodes.' : isNetwork ? 'Gateway link stability, signal quality, and delivery metrics.' : 'Prioritized alert queue and clinical response log.'

    return (
      <>
        <Sidebar />
        <div className="min-h-screen px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <button onClick={() => setActive('Overview')} className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-cyan-300">
                  <ChevronRight className="rotate-180" />Back to overview
                </button>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">Deep Space Ops / {active}</p>
                <h1 className="text-3xl font-bold tracking-tight text-white">{title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
              </div>
            </div>
            {isNetwork && <NetworkPulsePanel patients={patients} />}
            {isPatients && (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {patients.map((patient) => (
                  <button key={patient.id} onClick={() => { setSelectedId(patient.id); setActive('Overview') }} className="panel p-5 text-left transition hover:-translate-y-1 hover:border-cyan-400/40">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{patient.name}</p>
                        <p className="mt-1 font-mono text-[10px] text-slate-400">{patient.id} · {patient.room}</p>
                      </div>
                      <StatusBadge status={patient.status} />
                    </div>
                    <div className="mt-6 grid grid-cols-3 gap-3">
                      <div><p className="text-[10px] text-slate-400">HR</p><p className="mt-1 font-mono text-lg font-bold text-cyan-200">{patient.hr}</p></div>
                      <div><p className="text-[10px] text-slate-400">SpO₂</p><p className="mt-1 font-mono text-lg font-bold text-violet-200">{patient.spo2}%</p></div>
                      <div><p className="text-[10px] text-slate-400">Age</p><p className="mt-1 font-mono text-lg font-bold text-slate-200">{patient.age}</p></div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {active === 'Alerts' && (
              <div className="panel p-5">
                <h2 className="text-sm font-semibold text-white mb-4">Open Alert Queue</h2>
                <div className="flex flex-col gap-3">
                  {activeAlerts.length === 0 && <p className="text-sm text-slate-400">No active alerts. Deep space telemetry clear.</p>}
                  {activeAlerts.map(alert => (
                    <div key={alert.alert_id} className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">{alert.message}</p>
                          <p className="mt-1 text-xs text-slate-400">{alert.patient_id} · {alert.device_id}</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => handleAcknowledgeAlert(alert.alert_id)}>Ack</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // Overview Page
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen text-slate-100">
      <Sidebar />
      <div className="lg:pl-[240px]">
        {/* Deep Space Navigation Header */}
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-cyan-500/15 bg-black/80 px-5 backdrop-blur-2xl sm:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden"><Menu /></Button>
            <div>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-cyan-400 animate-ping" />
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400 font-semibold">DEEP-SPACE TELEMETRY NODE</p>
              </div>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-slate-100">Cosmic Mission Overview</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`hidden items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] font-semibold sm:flex ${
              connected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}>
              <Wifi className="size-3.5" />
              {connected ? 'STARLINK MESH LOCK' : 'SIGNAL SEARCHING'}
              <span className="font-mono opacity-60">· 2.4 GHz</span>
            </div>
            <Button variant="ghost" size="icon" className="text-slate-300 hover:text-cyan-300"><Bell /></Button>
            <div className="grid size-9 place-items-center rounded-full border border-cyan-400/40 bg-cyan-500/15 text-xs font-bold text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
              OPS
            </div>
          </div>
        </header>

        {!connected && (
          <div role="status" className="flex items-center justify-center gap-2 border-b border-rose-500/30 bg-rose-500/15 px-4 py-2.5 text-xs font-medium text-rose-200 backdrop-blur-md">
            <RefreshCw className="animate-spin size-4" />
            Connection lost to ground station. Reconnecting mesh telemetry streams…
          </div>
        )}

        <main className="mx-auto max-w-[1600px] p-5 sm:p-8">
          <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-cyan-400 font-semibold">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · {lastSync}
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Welcome back, Flight Director.
              </h2>
              <p className="mt-2 max-w-xl text-sm text-slate-400">
                All 5 patient nodes are emitting encrypted real-time vitals across the local mesh network.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 font-mono text-[11px] text-slate-400 backdrop-blur-xl">
                <Clock3 className="size-3.5 text-cyan-400" />
                Updated {connected ? 'just now' : '—'}
              </span>
              <Button variant="outline" size="sm" onClick={loadData} className="border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20">
                <RefreshCw className="mr-1.5 size-3.5" /> Sync Mesh
              </Button>
            </div>
          </div>

          <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Metric icon={HeartPulse} label="Patients Monitored" value={String(patients.length).padStart(2, '0')} unit="active" tone="cyan" trend="100%" />
            <Metric icon={Radio} label="Nodes Online" value={`${onlineCount}/${String(patients.length).padStart(2, '0')}`} unit="nodes" tone="emerald" />
            <Metric icon={AlertTriangle} label="Requires Attention" value={attentionCount} unit="patients" tone="amber" />
            <Metric icon={Gauge} label="Delivery Ratio" value={networkMetrics?.delivery_ratio ?? '—'} unit="%" tone="violet" trend={networkMetrics?.delivery_ratio ? '↑' : undefined} />
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1fr_360px]">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3 className="section-title">Patient Telemetry Streams</h3>
                  <p className="section-subtitle">Real-time vital signs from active space mesh nodes</p>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-slate-500" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Find patient node…"
                    aria-label="Find patient"
                    className="h-9 w-44 rounded-xl border border-white/10 bg-black/40 pl-8 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
                  />
                </div>
              </div>
              <div className="grid gap-3.5 p-4 md:grid-cols-2">
                {filteredPatients.map(p => (
                  <PatientCard key={p.id} patient={p} selected={p.id === selectedId} onSelect={() => { setSelectedId(p.id); setActive('Patients') }} />
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3 className="section-title">Local Mesh Health</h3>
                  <p className="section-subtitle">Gateway & relay link matrix</p>
                </div>
                <Network className="size-4 text-cyan-300" />
              </div>
              <div className="p-5">
                <div className="relative mx-auto flex size-56 items-center justify-center">
                  <div className="absolute inset-4 rounded-full border border-dashed border-cyan-400/30 animate-spin" style={{ animationDuration: '30s' }} />
                  <div className="absolute inset-12 rounded-full border border-cyan-400/20" />
                  <div className="absolute size-16 rounded-full border border-cyan-300/50 bg-cyan-500/20 p-1 shadow-[0_0_30px_rgba(34,211,238,0.3)]">
                    <div className="grid size-full place-items-center rounded-full bg-cyan-400/20">
                      <Server className="size-6 text-cyan-200" />
                    </div>
                  </div>
                  {patients.map((p, i) => (
                    <div
                      key={p.id}
                      className={`absolute grid size-9 place-items-center rounded-xl border transition-all ${
                        p.status === 'stale'
                          ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                          : 'border-cyan-400/30 bg-black/80 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.2)]'
                      }`}
                      style={{ transform: `rotate(${i * (360 / patients.length)}deg) translateY(-85px) rotate(-${i * (360 / patients.length)}deg)` }}
                    >
                      <Cpu className="size-4" />
                    </div>
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">Delivery Ratio</p>
                    <p className="mt-1 font-mono text-xl font-bold text-cyan-200">{networkMetrics?.delivery_ratio ?? '—'} <span className="text-xs text-slate-500">%</span></p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">Events Logged</p>
                    <p className="mt-1 font-mono text-xl font-bold text-violet-200">{networkEvents.length} <span className="text-xs text-slate-500">total</span></p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {selected && (
            <section className="mt-8">
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h3 className="section-title">Telemetry Inspection · {selected.name}</h3>
                    <p className="section-subtitle">{selected.id} · sequence {selected.sequence}</p>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>
                <div className="grid grid-cols-2 gap-3.5 p-4 sm:grid-cols-4">
                  <Metric icon={HeartPulse} label="Heart Rate" value={selected.hr} unit="bpm" tone="cyan" />
                  <Metric icon={Activity} label="SpO₂ Saturation" value={selected.spo2} unit="%" tone="violet" />
                  <Metric icon={Thermometer} label="Temperature" value={selected.temp} unit="°C" tone="amber" />
                  <Metric icon={Signal} label="Signal Quality" value={Math.round(selected.signal * 100)} unit="%" tone="emerald" />
                </div>
                <div className="border-t border-white/10 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-200">Historical Signal Waveform</p>
                    <div className="flex gap-1.5">
                      {(['hr','spo2','temp'] as MetricKey[]).map(k => (
                        <button
                          key={k}
                          onClick={() => setMetric(k)}
                          className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold uppercase transition ${
                            metric === k ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                  <TrendChart history={selectedHistory} metric={metric} />
                </div>
              </div>
            </section>
          )}

          <p className="mt-12 text-center text-[10px] leading-relaxed text-slate-500 font-mono tracking-wider">
            DEEP-SPACE MESH TELEMETRY ENGINE · ACADEMIC SIMULATION HARNESS · NON-CLINICAL DATA
          </p>
        </main>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Check, ChevronRight, Circle,
  Clock3, Cpu, Gauge, HeartPulse, LayoutDashboard, Menu, Network, Radio, RefreshCw, Search,
  Server, Settings2, ShieldCheck, Signal, Thermometer, Wifi, X, Zap, FileText,
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

// Maps from patient IDs to display names / rooms / ages / colors.
const PATIENT_META: Record<string, { name: string; room: string; age: number; color: string }> = {
  'patient-01': { name: 'Avery Morgan', room: 'Ward A · 04', age: 68, color: 'cyan' },
  'patient-02': { name: 'Jordan Lee', room: 'Ward A · 07', age: 54, color: 'amber' },
  'patient-03': { name: 'Samira Patel', room: 'Ward B · 02', age: 72, color: 'violet' },
  'patient-04': { name: 'Elliot Chen', room: 'Ward B · 06', age: 43, color: 'rose' },
  'patient-05': { name: 'Kai Nakamura', room: 'Ward C · 01', age: 37, color: 'emerald' },
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
// Sub-components (unchanged UI, just receive data via props)
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Status }) {
  const config = { online: ['Online', 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20'], attention: ['Needs attention', 'text-amber-300 bg-amber-400/10 border-amber-400/20'], stale: ['Stale data', 'text-rose-300 bg-rose-400/10 border-rose-400/20'] }[status]
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${config[1]}`}><span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-50" /><span className="relative inline-flex size-1.5 rounded-full bg-current" /></span>{config[0]}</span>
}

function Metric({ icon: Icon, label, value, unit, tone = 'cyan', trend }: { icon: typeof Activity; label: string; value: string | number; unit: string; tone?: string; trend?: string }) {
  return <div className="metric-card"><div className="flex items-center justify-between"><span className={`metric-icon ${tone}`}><Icon /></span>{trend && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-300"><ArrowUpRight />{trend}</span>}</div><div className="mt-4 flex items-end gap-1"><span className="font-mono text-2xl font-semibold tracking-tight text-slate-100">{value}</span><span className="mb-1 text-xs text-slate-500">{unit}</span></div><p className="mt-1 text-[11px] uppercase tracking-[.14em] text-slate-500">{label}</p></div>
}

function PatientCard({ patient, selected, onSelect }: { patient: Patient; selected: boolean; onSelect: () => void }) {
  return <button onClick={onSelect} className={`group w-full rounded-xl border p-4 text-left transition-all ${selected ? 'border-cyan-400/50 bg-cyan-400/[.07] shadow-[0_0_30px_rgba(34,211,238,.06)]' : 'border-white/[.07] bg-white/[.025] hover:border-white/15 hover:bg-white/[.045]'}`}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className={`grid size-9 shrink-0 place-items-center rounded-lg bg-${patient.color}-400/10 text-${patient.color}-300`}><HeartPulse /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-200">{patient.name}</p><p className="mt-0.5 font-mono text-[10px] text-slate-500">{patient.id} · {patient.room}</p></div></div><StatusBadge status={patient.status} /></div><div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/[.06] pt-3"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">Heart rate</p><p className="mt-1 font-mono text-sm text-slate-200">{patient.hr}<span className="ml-1 text-[10px] text-slate-500">bpm</span></p></div><div><p className="text-[10px] uppercase tracking-wider text-slate-500">SpO₂</p><p className="mt-1 font-mono text-sm text-slate-200">{patient.spo2}<span className="ml-1 text-[10px] text-slate-500">%</span></p></div><div><p className="text-[10px] uppercase tracking-wider text-slate-500">Freshness</p><p className={`mt-1 font-mono text-sm ${patient.status === 'stale' ? 'text-rose-300' : 'text-slate-200'}`}>{formatTimeAgo(patient.lastSeen)}</p></div></div><div className="mt-4 flex items-center justify-between text-[10px] text-slate-500"><span className="flex items-center gap-1.5"><Signal /> Signal {Math.round(patient.signal * 100)}%</span><span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">Open profile <ChevronRight /></span></div></button>
}

function TrendChart({ history, metric }: { history: HistoryPoint[]; metric: MetricKey }) {
  const config = { hr: { label: 'Heart rate', unit: 'bpm', color: '#22d3ee', domain: [50, 170] }, spo2: { label: 'SpO₂ saturation', unit: '%', color: '#a78bfa', domain: [90, 100] }, temp: { label: 'Temperature', unit: '°C', color: '#fbbf24', domain: [35.5, 38.5] } }[metric]
  return <div className="h-[220px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}><defs><linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={config.color} stopOpacity={.22} /><stop offset="95%" stopColor={config.color} stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(148,163,184,.09)" vertical={false} /><XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis domain={config.domain} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#111b2b', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, fontSize: 11 }} labelStyle={{ color: '#94a3b8' }} formatter={(value) => [`${value} ${config.unit}`, config.label]} /><Area type="monotone" dataKey={metric} stroke={config.color} strokeWidth={2} fill={`url(#fill-${metric})`} connectNulls={false} /></AreaChart></ResponsiveContainer></div>
}

function RoundsPage({ patients, onBack }: { patients: Patient[]; onBack: () => void }) {
  const [completed, setCompleted] = useState<string[]>([])
  const toggle = (id: string) => setCompleted((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const tasks = patients.map((patient, index) => ({ id: patient.id, patient, task: index === 0 ? 'Review overnight vitals' : index === 1 ? 'Escalate elevated heart rate' : index === 2 ? 'Confirm medication response' : index === 3 ? 'Reconnect bedside sensor' : 'Check signal quality', due: index === 1 ? 'Priority · now' : `${index + 1}0 min` }))
  return <div className="min-h-screen bg-[#07101d] px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8"><div className="mx-auto max-w-7xl"><button onClick={onBack} className="mb-6 flex items-center gap-2 text-xs font-medium text-slate-500 transition hover:text-cyan-300"><ChevronRight className="rotate-180" />Back to overview</button><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-300">Command center / rounds</p><h1 className="text-3xl font-semibold tracking-tight text-white">Rounding workspace</h1><p className="mt-2 text-sm leading-6 text-slate-400">A focused handoff queue for the next bedside review.</p></div><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.05] px-4 py-3"><p className="text-[10px] uppercase tracking-widest text-slate-500">Progress</p><p className="mt-1 font-mono text-lg text-cyan-200">{completed.length}/{tasks.length} complete</p></div></div><div className="grid gap-5 lg:grid-cols-[1.4fr_.8fr]"><section className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-white">Today&apos;s review queue</h2><p className="mt-1 text-xs text-slate-500">Prioritized from live telemetry and freshness.</p></div><span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300">{tasks.length - completed.length} open</span></div><div className="flex flex-col gap-3">{tasks.map(({ id, patient, task, due }) => { const done = completed.includes(id); return <button key={id} onClick={() => toggle(id)} className={`flex items-center gap-4 rounded-xl border p-4 text-left transition ${done ? 'border-emerald-300/20 bg-emerald-300/[.05]' : 'border-white/[.07] bg-white/[.025] hover:border-cyan-300/25'}`}><span className={`grid size-8 shrink-0 place-items-center rounded-full border ${done ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-300' : 'border-white/15 text-transparent'}`}><Check /></span><span className="min-w-0 flex-1"><span className={`block text-sm font-medium ${done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{task}</span><span className="mt-1 block text-[11px] text-slate-500">{patient.name} · {patient.room}</span></span><span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${due.startsWith('Priority') ? 'text-amber-300' : 'text-slate-500'}`}>{due}</span></button> })}</div></section><aside className="flex flex-col gap-5"><div className="rounded-2xl border border-amber-300/15 bg-amber-300/[.05] p-5"><div className="flex items-center gap-2 text-amber-300"><AlertTriangle /><h2 className="text-sm font-semibold">Clinical watch</h2></div><p className="mt-3 text-sm leading-6 text-slate-300">{patients.find(p => p.status === 'attention')?.name || 'No patients'} requires clinical attention. Keep this patient first in the round.</p><button onClick={() => { const attn = patients.find(p => p.status === 'attention'); if (attn) toggle(attn.id) }} className="mt-4 rounded-lg bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-300/25">Mark reviewed</button></div><div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><h2 className="text-sm font-semibold text-white">Rounding notes</h2><textarea aria-label="Rounding notes" placeholder="Add a note for the next shift..." className="mt-4 min-h-28 w-full resize-none rounded-xl border border-white/[.08] bg-black/10 p-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/40" /><p className="mt-3 text-[10px] text-slate-500">Notes stay in this local workspace until synced.</p></div></aside></div></div></div>
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
  return <div className="min-h-screen bg-[#07101d] px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8"><div className="mx-auto max-w-7xl"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><button onClick={onBack} className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-500 transition hover:text-cyan-300"><ChevronRight className="rotate-180" />Back to overview</button><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-300">Command center / reports</p><h1 className="text-3xl font-semibold tracking-tight text-white">Clinical operations report</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">A concise performance readout for telemetry quality, response velocity, and shift handoff.</p></div><div className="flex items-center gap-2"><div className="flex rounded-lg border border-white/[.08] bg-white/[.03] p-1">{['24h', '7d', '30d'].map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${range === item ? 'bg-cyan-300/15 text-cyan-200' : 'text-slate-500 hover:text-slate-200'}`}>{item}</button>)}</div><button onClick={() => setExported(true)} className="flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/10"><FileText />{exported ? 'Report ready' : 'Export report'}</button></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{reportRows.map((row) => <div key={row.label} className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><p className="text-[10px] uppercase tracking-[.16em] text-slate-500">{row.label}</p><p className={`mt-4 font-mono text-2xl font-semibold ${row.tone}`}>{row.value}</p><p className="mt-2 text-xs text-slate-500">{row.detail}</p></div>)}</div><div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_.65fr]"><section className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold text-white">Ward performance</h2><p className="mt-1 text-xs text-slate-500">Operational indicators for the selected period.</p></div><span className="rounded-full border border-emerald-300/20 bg-emerald-300/[.06] px-2.5 py-1 text-[10px] font-semibold text-emerald-300">{range} snapshot</span></div><div className="mt-6 flex flex-col gap-4">{[['Data freshness', patients.filter(p => p.status === 'online').length / Math.max(1, patients.length) * 100, 'Most devices reporting within 5 seconds'], ['Signal quality average', averageSignal, 'Review queue is trending down'], ['Round completion', 64, 'Handoff items tracked separately']].map(([label, value, detail]) => <div key={String(label)}><div className="mb-2 flex items-center justify-between text-xs"><span className="text-slate-300">{label}</span><span className="font-mono text-slate-400">{typeof value === 'number' ? Math.round(value) : value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" style={{ width: `${value}%` }} /></div><p className="mt-2 text-[11px] text-slate-500">{detail}</p></div>)}</div></section><section className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-violet-400/10 text-violet-300"><FileText /></span><div><h2 className="text-sm font-semibold text-white">Shift summary</h2><p className="text-[11px] text-slate-500">Prepared for handoff</p></div></div><p className="mt-5 text-sm leading-6 text-slate-300">Telemetry is {patients.filter(p => p.status === 'online').length === patients.length ? 'stable across the ward' : 'partially degraded'}. {patients.find(p => p.status === 'attention')?.name || 'No patient'} is the primary watch item{patients.find(p => p.status === 'stale') ? `, while ${patients.find(p => p.status === 'stale')?.name} needs a sensor reconnection` : ''}.</p><div className="mt-5 rounded-xl border border-amber-300/15 bg-amber-300/[.05] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-amber-300">Recommended next step</p><p className="mt-1 text-xs leading-5 text-slate-300">Resolve any stale data, then review elevated vital signs with the care team.</p></div></section></div></div></div>
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
  return <div className="min-h-screen bg-[#07101d] px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8"><div className="mx-auto max-w-5xl"><button onClick={onBack} className="mb-6 flex items-center gap-2 text-xs font-medium text-slate-500 transition hover:text-cyan-300"><ChevronRight className="rotate-180" />Back to overview</button><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-300">Command center / settings</p><h1 className="text-3xl font-semibold tracking-tight text-white">Workspace settings</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Tune alert behavior, care-team routing, and the way Mesh Monitor supports your shift.</p></div><div className="rounded-xl border border-violet-300/15 bg-violet-300/[.05] px-4 py-3"><p className="text-[10px] uppercase tracking-widest text-slate-500">Workspace</p><p className="mt-1 text-sm font-medium text-violet-200">Ward A · Night shift</p></div></div><div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><section className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><div className="mb-5"><h2 className="text-sm font-semibold text-white">Alert preferences</h2><p className="mt-1 text-xs text-slate-500">Control how clinical signals reach your team.</p></div><div className="flex flex-col gap-3">{preferences.map((preference) => <div key={preference.label} className="flex items-center justify-between gap-4 rounded-xl border border-white/[.07] bg-white/[.025] p-4"><div><p className="text-sm font-medium text-slate-200">{preference.label}</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-500">{preference.detail}</p></div><button onClick={() => preference.setValue(!preference.value)} aria-pressed={preference.value} className={`relative h-6 w-11 shrink-0 rounded-full border transition ${preference.value ? 'border-cyan-300/40 bg-cyan-300/20' : 'border-white/10 bg-white/[.06]'}`}><span className={`absolute top-1 size-4 rounded-full transition ${preference.value ? 'left-6 bg-cyan-200' : 'left-1 bg-slate-500'}`} /></button></div>)}</div></section><div className="flex flex-col gap-5"><section className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><h2 className="text-sm font-semibold text-white">Clinical thresholds</h2><p className="mt-1 text-xs text-slate-500">Current safety bands for new patient alerts.</p><div className="mt-5 flex flex-col gap-3">{[['Heart rate', '50–120', 'bpm'], ['SpO₂ minimum', '94', '%'], ['Temperature', '36.0–38.0', '°C']].map(([label, value, unit]) => <div key={label} className="flex items-center justify-between rounded-xl bg-white/[.035] px-3 py-3"><span className="text-xs text-slate-400">{label}</span><span className="font-mono text-xs text-cyan-200">{value} <span className="text-slate-500">{unit}</span></span></div>)}</div></section><section className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.04] p-5"><div className="flex items-start gap-3"><ShieldCheck className="text-cyan-300" /><div><h2 className="text-sm font-semibold text-white">Configuration health</h2><p className="mt-1 text-xs leading-5 text-slate-400">All ward policies are synced and ready for the next handoff.</p></div></div><button onClick={() => setSaved(true)} className="mt-5 w-full rounded-lg bg-cyan-300 px-3 py-2.5 text-xs font-bold text-[#07101d] transition hover:bg-cyan-200">{saved ? 'Settings saved' : 'Save preferences'}</button></section></div></div></div></div>
}

function PulseNode({ patient, index }: { patient: Patient; index: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const angle = index * Math.PI * 2 / 5
  const position: [number, number, number] = [Math.cos(angle) * 2.15, Math.sin(angle) * 1.15, Math.sin(angle) * 1.2]
  useFrame(({ clock }) => { if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2.2 + index) * .08) })
  const color = patient.status === 'attention' ? '#fbbf24' : patient.status === 'stale' ? '#fb7185' : '#22d3ee'
  return <group position={position}><mesh ref={ref}><sphereGeometry args={[.22, 24, 24]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.8} /></mesh><Text position={[0, .42, 0]} fontSize={.105} color="#e2e8f0" anchorX="center" anchorY="middle" outlineWidth={.012} outlineColor="#091522">{patient.name}</Text><Text position={[0, .27, 0]} fontSize={.075} color="#64748b" anchorX="center" anchorY="middle">{`${patient.signal * 100 | 0}% signal`}</Text></group>
}

function NetworkPulsePanel({ patients }: { patients: Patient[] }) {
  const links = patients.map((_, index) => <line key={index}><bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, Math.cos(index * Math.PI * 2 / patients.length) * 2.15, Math.sin(index * Math.PI * 2 / patients.length) * 1.15, Math.sin(index * Math.PI * 2 / patients.length) * 1.2]), 3]} /></bufferGeometry><lineBasicMaterial color="#22d3ee" transparent opacity={.28} /></line>)
  return <section className="network-pulse mb-5 overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#071522] shadow-[0_0_80px_rgba(34,211,238,.08),0_24px_70px_rgba(0,0,0,.3)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] bg-gradient-to-r from-cyan-300/[.06] via-transparent to-violet-300/[.04] px-5 py-4"><div><div className="flex items-center gap-2"><span className="size-2 animate-pulse rounded-full bg-cyan-300" /><h2 className="text-sm font-semibold text-white">Network Pulse · 3D topology</h2></div><p className="mt-1 text-xs text-slate-500">Orbit the ward mesh to inspect live bedside signal paths.</p></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.06] px-2.5 py-1 font-mono text-[10px] text-cyan-200">{patients.length} nodes · 1 gateway</span></div><div className="h-[360px] w-full"><Canvas camera={{ position: [0, 1.4, 6.8], fov: 42 }} dpr={[1, 1.5]}><color attach="background" args={['#091522']} /><ambientLight intensity={.65} /><pointLight position={[0, 2, 4]} intensity={16} color="#22d3ee" /><mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.35, 0]}><circleGeometry args={[3.4, 64]} /><meshBasicMaterial color="#0d2534" transparent opacity={.6} /></mesh><mesh><sphereGeometry args={[.42, 32, 32]} /><meshStandardMaterial color="#a78bfa" emissive="#7c3aed" emissiveIntensity={1.4} /></mesh>{links}{patients.map((patient, index) => <PulseNode key={patient.id} patient={patient} index={index} />)}<OrbitControls enablePan={false} minDistance={4.5} maxDistance={9} /></Canvas></div></section>
}

// ---------------------------------------------------------------------------
// Main dashboard — powered by the real backend
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

  // Track latest measurement per device for patient building
  const latestMeasurements = useRef<Record<string, Measurement>>({})

  const selected = patients.find(p => p.id === selectedId) ?? patients[0]

  // ---- Initial data load ----
  const loadData = useCallback(async () => {
    try {
      const [devRes, alertRes, netRes] = await Promise.all([
        fetchDevices(),
        fetchAlerts(),
        fetchNetworkMetrics(),
      ])

      // Build patients from devices
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
      // Silently handle — connection status will reflect the issue.
    }
  }, [])

  // Load measurement history for a patient
  const loadHistory = useCallback(async (patientId: string) => {
    try {
      const res = await fetchMeasurements(patientId, { limit: 50 })
      const points = measurementsToHistory(res.items)
      setHistory(prev => ({ ...prev, [patientId]: points }))
      // Update latest measurement
      if (res.items.length > 0) {
        const last = res.items[res.items.length - 1]
        latestMeasurements.current[last.device_id] = last
      }
    } catch { /* ignore */ }
  }, [])

  // ---- Initial + periodic data fetch ----
  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 3000)
    return () => clearInterval(interval)
  }, [loadData])

  // ---- Load history for all patients on mount ----
  useEffect(() => {
    const patientIds = Object.keys(PATIENT_META)
    patientIds.forEach(id => loadHistory(id))
    const interval = setInterval(() => {
      patientIds.forEach(id => loadHistory(id))
    }, 5000)
    return () => clearInterval(interval)
  }, [loadHistory])

  // ---- WebSocket for real-time updates ----
  useEffect(() => {
    const unsub = subscribe((msg: RealtimeMessage) => {
      if (msg.type === 'measurement') {
        const m = msg.payload as Measurement
        latestMeasurements.current[m.device_id] = m
        // Append to history
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
        // Update the patient's vitals immediately
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

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (event.key === '/' && !typing) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus()
      }
      if (event.key === 'Escape') {
        setBriefOpen(false)
        ;(document.activeElement as HTMLElement | null)?.blur()
      }
      if (!typing && event.key >= '1' && event.key <= '7') {
        const item = navItems[Number(event.key) - 1]
        if (item) setActive(item.label)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  // ---- Acknowledge alert handler ----
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

  // ---- Sidebar component (DRY) ----
  const Sidebar = () => (
    <aside className="fixed inset-y-0 left-0 z-10 hidden w-[240px] border-r border-white/[.07] bg-[#091522] lg:block"><div className="flex h-full flex-col p-5"><div className="mb-8 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><Activity /></span><div><p className="text-sm font-semibold text-white">Mesh Monitor</p><p className="text-[10px] uppercase tracking-widest text-slate-500">Clinical ops</p></div></div><nav className="flex flex-col gap-1">{navItems.map(({ label, icon: Icon }) => <button key={label} onClick={() => setActive(label)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition ${active === label ? 'bg-cyan-300/10 text-cyan-200' : 'text-slate-500 hover:bg-white/[.04] hover:text-slate-200'}`}><Icon />{label}{label === 'Alerts' && activeAlerts.length > 0 && <span className="ml-auto rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">{activeAlerts.length}</span>}</button>)}</nav><div className="mt-auto rounded-xl border border-white/[.07] bg-white/[.03] p-3"><p className="text-[10px] uppercase tracking-widest text-slate-500">Ward coverage</p><p className="mt-2 font-mono text-lg text-white">{onlineCount}/{patients.length}</p><p className="mt-1 text-[10px] text-emerald-300">devices connected</p></div></div></aside>
  )

  if (active === 'Reports') return <><Sidebar /><ReportsPage patients={patients} networkMetrics={networkMetrics} onBack={() => setActive('Overview')} /></>
  if (active === 'Settings') return <><Sidebar /><SettingsPage onBack={() => setActive('Overview')} /></>
  if (active === 'Rounds') return <><Sidebar /><RoundsPage patients={patients} onBack={() => setActive('Overview')} /></>

  if (active === 'Patients' || active === 'Network' || active === 'Alerts') {
    const isPatients = active === 'Patients'
    const isNetwork = active === 'Network'
    const title = isPatients ? 'Patient directory' : isNetwork ? 'Network health' : 'Alert center'
    const description = isPatients ? 'A complete, searchable view of every connected patient and their latest telemetry.' : isNetwork ? 'Device connectivity, signal quality, and ingestion performance across the ward.' : 'Review, acknowledge, and hand off the signals that need clinical attention.'
    return <><Sidebar /><div className="min-h-screen bg-[#07101d] px-4 py-6 text-slate-100 sm:px-6 lg:ml-[240px] lg:px-10 lg:py-8"><div className="mx-auto max-w-7xl"><div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><button onClick={() => setActive('Overview')} className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-500 transition hover:text-cyan-300"><ChevronRight className="rotate-180" />Back to overview</button><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-300">Command center / {active}</p><h1 className="text-3xl font-semibold tracking-tight text-white">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p></div><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[.06] px-4 py-3"><p className="text-[10px] uppercase tracking-widest text-emerald-300">Live telemetry</p><p className="mt-1 font-mono text-sm text-slate-200">{onlineCount} devices reporting</p></div></div>
    {isNetwork && <NetworkPulsePanel patients={patients} />}
    {isPatients && <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{patients.map((patient) => <button key={patient.id} onClick={() => { setSelectedId(patient.id); setActive('Overview') }} className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-cyan-300/[.05]"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{patient.name}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{patient.id} · {patient.room}</p></div><StatusBadge status={patient.status} /></div><div className="mt-6 grid grid-cols-3 gap-3"><div><p className="text-[10px] text-slate-500">HR</p><p className="mt-1 font-mono text-lg text-cyan-200">{patient.hr}</p></div><div><p className="text-[10px] text-slate-500">SpO₂</p><p className="mt-1 font-mono text-lg text-violet-200">{patient.spo2}%</p></div><div><p className="text-[10px] text-slate-500">Age</p><p className="mt-1 font-mono text-lg text-slate-200">{patient.age}</p></div></div><div className="mt-5 flex items-center justify-between border-t border-white/[.07] pt-3 text-[10px] text-slate-500"><span>Signal {Math.round(patient.signal * 100)}%</span><span className="text-cyan-300">View timeline <ChevronRight /></span></div></button>)}</div>}
    {isNetwork && <div className="grid gap-5 lg:grid-cols-[1.3fr_.7fr]"><div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><div className="mb-6 flex items-center justify-between"><div><h2 className="font-semibold text-white">Ward connectivity</h2><p className="mt-1 text-xs text-slate-500">Last 15 minutes · refreshed live</p></div><Wifi className="text-cyan-300" /></div><div className="flex flex-col gap-4">{patients.map((patient) => <div key={patient.id} className="flex items-center gap-4 rounded-xl border border-white/[.06] bg-black/10 p-4"><span className={`grid size-10 place-items-center rounded-xl ${patient.status === 'stale' ? 'bg-rose-400/10 text-rose-300' : 'bg-cyan-400/10 text-cyan-300'}`}><Radio /></span><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="text-sm font-medium text-slate-200">{patient.name}</p><p className="font-mono text-xs text-slate-400">{Math.round(patient.signal * 100)}%</p></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.07]"><div className={`h-full rounded-full ${patient.status === 'stale' ? 'bg-rose-400' : 'bg-cyan-300'}`} style={{ width: `${patient.signal * 100}%` }} /></div><p className="mt-2 text-[10px] text-slate-500">{patient.room} · sequence {patient.sequence}</p></div></div>)}</div></div><div className="flex flex-col gap-5"><div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><p className="text-xs text-slate-500">Delivery ratio</p><p className="mt-2 font-mono text-4xl text-white">{networkMetrics?.delivery_ratio ?? '—'}<span className="text-lg text-slate-500">%</span></p><p className="mt-3 text-xs text-emerald-300">Gateway packet acceptance</p></div><div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><p className="text-xs text-slate-500">Recent events</p><div className="mt-4 flex flex-col gap-3 text-xs">{networkEvents.slice(0, 5).map(evt => <div key={evt.event_id} className="flex justify-between"><span className="text-slate-400 truncate max-w-[140px]">{evt.detail}</span><span className="font-mono text-slate-500 shrink-0">{formatMs(evt.at_ms)}</span></div>)}{networkEvents.length === 0 && <p className="text-slate-500">No events yet</p>}</div></div></div></div>}
    {active === 'Alerts' && <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]"><div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold text-white">Open alerts</h2><p className="mt-1 text-xs text-slate-500">Prioritized by clinical urgency</p></div><span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">{activeAlerts.length} active</span></div><div className="flex flex-col gap-3">{activeAlerts.length === 0 && <p className="p-4 text-sm text-slate-400">No active alerts. All clear.</p>}{activeAlerts.map((alert) => <div key={alert.alert_id} className="rounded-xl border border-amber-300/15 bg-amber-300/[.05] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-white">{alert.message}</p><p className="mt-1 text-xs leading-5 text-slate-400">{alert.device_id} · {alert.patient_id} · {formatMs(alert.raised_at_ms)}</p></div><AlertTriangle className="text-amber-300 shrink-0" /></div><div className="mt-4 flex items-center justify-between text-[10px] text-slate-500"><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${alert.severity === 'critical' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300'}`}>{alert.severity}</span><button onClick={() => handleAcknowledgeAlert(alert.alert_id)} className="font-semibold text-cyan-300 hover:text-cyan-200">Acknowledge</button></div></div>)}</div></div><div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5"><p className="text-xs text-slate-500">Response workflow</p><div className="mt-5 flex flex-col gap-5">{['Review the patient timeline', 'Acknowledge the signal', 'Add a handoff note'].map((step, index) => <div key={step} className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 font-mono text-xs text-cyan-200">{index + 1}</span><div><p className="text-sm text-slate-200">{step}</p><p className="mt-1 text-xs text-slate-500">{index === 0 ? 'Compare against the last 30 minutes of vitals.' : index === 1 ? 'Keep the escalation trail visible to the team.' : 'Share context with the next shift.'}</p></div></div>)}</div></div></div>}
    </div></div></>
  }

  // ---- Overview page ----
  return <div className="min-h-screen bg-[#07101d] text-slate-100"><button onClick={() => setBriefOpen(true)} className="fixed bottom-5 left-5 z-20 flex items-center gap-2 rounded-full border border-cyan-400/20 bg-[#102338]/90 px-4 py-2.5 text-xs font-semibold text-cyan-200 shadow-lg shadow-cyan-950/20 backdrop-blur-xl transition-all hover:border-cyan-300/40 hover:bg-[#15304a] lg:left-[260px]" aria-label="Open shift handoff brief"><Activity />Shift handoff</button>
  <section className={`fixed bottom-5 right-5 z-30 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1a2a]/95 shadow-2xl shadow-black/30 backdrop-blur-xl transition-all ${briefOpen ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0'}`} aria-label="Shift handoff brief"><div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3"><div><p className="text-xs font-semibold text-slate-200">Shift handoff brief</p><p className="mt-0.5 text-[10px] text-slate-500">Prepared just now · Night shift</p></div><button onClick={() => setBriefOpen(false)} className="rounded-md p-1 text-slate-500 hover:bg-white/[.06] hover:text-slate-200" aria-label="Close handoff brief"><X /></button></div><div className="flex flex-col gap-3 p-4"><div className="rounded-xl border border-amber-400/15 bg-amber-400/[.06] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-amber-300">Priority watch</p><p className="mt-1 text-xs leading-relaxed text-slate-300">{patients.find(p => p.status === 'attention')?.name || 'No patients'} needs attention. Review before rounds.</p></div><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-white/[.04] p-3"><p className="text-slate-500">Coverage</p><p className="mt-1 font-mono text-slate-200">{onlineCount}/{patients.length} connected</p></div><div className="rounded-lg bg-white/[.04] p-3"><p className="text-slate-500">Open alerts</p><p className="mt-1 font-mono text-amber-300">{activeAlerts.length}</p></div></div><button onClick={() => setHandoffCopied(true)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20">{handoffCopied ? 'Handoff marked ready' : 'Mark handoff ready'}</button></div></section>
  <aside className="fixed inset-y-0 left-0 z-20 hidden w-[236px] border-r border-white/[.07] bg-[#091522] lg:flex lg:flex-col"><div className="flex h-[76px] items-center gap-3 border-b border-white/[.07] px-6"><div className="grid size-8 place-items-center rounded-lg bg-cyan-400/15 text-cyan-300"><Activity /></div><div><p className="text-sm font-bold tracking-tight">MESH<span className="text-cyan-300">/</span>MONITOR</p><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[.2em] text-slate-500">Operations console</p></div></div><nav className="flex-1 px-3 py-6"><p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-600">Workspace</p>{navItems.map(item => <button key={item.label} onClick={() => setActive(item.label)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active === item.label ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-white/[.04] hover:text-slate-200'}`}><item.icon />{item.label}{item.label === 'Alerts' && activeAlerts.length > 0 && <span className="ml-auto rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">{activeAlerts.length}</span>}</button>)}</nav><div className="border-t border-white/[.07] p-4"><div className="rounded-lg border border-white/[.07] bg-white/[.025] p-3"><div className="flex items-center gap-2"><ShieldCheck className="text-emerald-300" /><span className="text-xs font-semibold text-slate-300">Prototype environment</span></div><p className="mt-2 text-[10px] leading-relaxed text-slate-500">All telemetry is simulated for academic demonstration.</p></div><p className="mt-4 px-1 font-mono text-[9px] text-slate-600">v0.8.4 · LOCAL MESH</p></div></aside>
  <div className="lg:pl-[236px]"><header className="sticky top-0 z-10 flex h-[76px] items-center justify-between border-b border-white/[.07] bg-[#07101d]/90 px-5 backdrop-blur-xl sm:px-8"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="lg:hidden"><Menu /></Button><div><div className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-cyan-300" /><p className="font-mono text-[10px] uppercase tracking-[.2em] text-slate-500">Live command center</p></div><h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-100">System overview</h1></div></div><div className="flex items-center gap-3"><div className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-medium sm:flex ${connected ? 'border-emerald-400/20 bg-emerald-400/[.06] text-emerald-300' : 'border-rose-400/30 bg-rose-400/[.08] text-rose-300'}`}><Wifi />{connected ? 'Mesh connected' : 'Connection interrupted'}<span className="font-mono opacity-60">· 2.4 GHz</span></div><Button variant="ghost" size="icon"><Bell /></Button><div className="grid size-8 place-items-center rounded-full border border-cyan-300/30 bg-cyan-400/10 text-xs font-semibold text-cyan-200">OP</div></div></header>
  {!connected && <div role="status" className="flex items-center justify-center gap-2 border-b border-rose-400/20 bg-rose-400/[.08] px-4 py-2 text-xs text-rose-200"><RefreshCw className="animate-spin" />Realtime connection interrupted. Showing last known telemetry while reconnecting…</div>}
  <main className="mx-auto max-w-[1600px] p-5 sm:p-8"><div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-cyan-300/70">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · {lastSync}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">Good morning, operator.</h2><p className="mt-2 max-w-xl text-sm text-slate-400">Your monitoring mesh is active. Here&apos;s the current state of your simulated ward.</p></div><div className="flex items-center gap-2"><span className="flex items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.025] px-3 py-2 font-mono text-[11px] text-slate-400"><Clock3 />Updated {connected ? 'just now' : '—'}</span><Button variant="outline" size="sm" onClick={loadData}><RefreshCw data-icon="inline-start" />Sync now</Button></div></div>
  <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Metric icon={HeartPulse} label="Patients monitored" value={String(patients.length).padStart(2, '0')} unit="active" tone="cyan" trend="100%" /><Metric icon={Radio} label="Nodes online" value={`${onlineCount}/${String(patients.length).padStart(2, '0')}`} unit="nodes" tone="emerald" /><Metric icon={AlertTriangle} label="Requires attention" value={attentionCount} unit="patients" tone="amber" /><Metric icon={Gauge} label="Delivery ratio" value={networkMetrics?.delivery_ratio ?? '—'} unit="%" tone="violet" trend={networkMetrics?.delivery_ratio ? '↑' : undefined} /></section>
  <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]"><div className="panel"><div className="panel-header"><div><h3 className="section-title">Patient telemetry</h3><p className="section-subtitle">Latest readings from all connected sensor nodes</p></div><div className="relative"><Search className="absolute left-2.5 top-2.5 text-slate-500" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find patient…" aria-label="Find patient" className="h-8 w-40 rounded-md border border-white/10 bg-white/[.04] pl-8 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-300/50" /></div></div><div className="grid gap-3 p-4 md:grid-cols-2">{filteredPatients.map(p => <PatientCard key={p.id} patient={p} selected={p.id === selectedId} onSelect={() => { setSelectedId(p.id); setActive('Patients') }} />)}</div></div>
  <div className="panel"><div className="panel-header"><div><h3 className="section-title">Network pulse</h3><p className="section-subtitle">Local mesh health · live</p></div><Network className="text-cyan-300" /></div><div className="p-5"><div className="relative mx-auto flex size-52 items-center justify-center"><div className="absolute inset-5 rounded-full border border-dashed border-cyan-400/25" /><div className="absolute inset-12 rounded-full border border-cyan-400/20" /><div className="absolute size-16 rounded-full border border-cyan-300/40 bg-cyan-400/10 p-1"><div className="grid size-full place-items-center rounded-full bg-cyan-400/10"><Server className="text-cyan-200" /></div></div>{patients.map((p, i) => <div key={p.id} className={`absolute grid size-9 place-items-center rounded-lg border ${p.status === 'stale' ? 'border-rose-400/40 bg-rose-400/10 text-rose-300' : 'border-white/10 bg-[#102237] text-slate-300'}`} style={{ transform: `rotate(${i * (360 / patients.length)}deg) translateY(-78px) rotate(-${i * (360 / patients.length)}deg)` }}><Cpu /></div>)}<span className="absolute inset-x-8 top-1/2 border-t border-dashed border-cyan-300/20" /><span className="absolute inset-y-8 left-1/2 border-l border-dashed border-cyan-300/20" /></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg bg-white/[.03] p-3"><p className="text-[10px] uppercase tracking-wider text-slate-500">Delivery</p><p className="mt-1 font-mono text-lg text-slate-200">{networkMetrics?.delivery_ratio ?? '—'} <span className="text-xs text-slate-500">%</span></p></div><div className="rounded-lg bg-white/[.03] p-3"><p className="text-[10px] uppercase tracking-wider text-slate-500">Events</p><p className="mt-1 font-mono text-lg text-slate-200">{networkEvents.length} <span className="text-xs text-slate-500">total</span></p></div></div></div></div></section>
  <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]"><div className="panel"><div className="panel-header"><div><h3 className="section-title">Attention queue</h3><p className="section-subtitle">Actionable events requiring review</p></div><Button variant="ghost" size="sm" onClick={() => setActive('Alerts')}>View all <ChevronRight data-icon="inline-end" /></Button></div>{activeAlerts.length > 0 ? <div className="divide-y divide-white/[.06]">{activeAlerts.slice(0, 3).map(alert => <div key={alert.alert_id} className="flex items-center gap-4 p-4"><div className={`grid size-9 shrink-0 place-items-center rounded-lg ${alert.severity === 'critical' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300'}`}><AlertTriangle /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-slate-200">{alert.message}</p><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${alert.severity === 'critical' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300'}`}>{alert.severity}</span></div><p className="mt-1 text-xs text-slate-500">{alert.patient_id} · {alert.device_id} · {formatMs(alert.raised_at_ms)}</p></div><Button variant="outline" size="sm" onClick={() => handleAcknowledgeAlert(alert.alert_id)}><Check data-icon="inline-start" />Ack</Button></div>)}</div> : <div className="flex items-center gap-3 p-5 text-sm text-slate-400"><Check className="text-emerald-300" />No active alerts. All clear.</div>}</div>
  <div className="panel"><div className="panel-header"><div><h3 className="section-title">Recent network events</h3><p className="section-subtitle">Activity across the mesh</p></div><Zap className="text-violet-300" /></div><div className="divide-y divide-white/[.06]">{networkEvents.slice(0, 5).map(evt => <div key={evt.event_id} className="flex items-center gap-3 px-4 py-3"><span className={`size-1.5 rounded-full bg-current ${evt.type === 'route_change' ? 'text-cyan-300' : evt.type === 'buffer_backfill' ? 'text-emerald-300' : 'text-amber-300'}`} /><div className="min-w-0 flex-1"><p className="text-xs font-medium text-slate-300">{evt.type.replace(/_/g, ' ')}</p><p className="mt-0.5 truncate font-mono text-[10px] text-slate-600">{evt.device_id} · {evt.detail}</p></div><span className="font-mono text-[10px] text-slate-600">{formatMs(evt.at_ms)}</span></div>)}{networkEvents.length === 0 && <div className="p-4 text-xs text-slate-500">No events yet — the mesh is quiet.</div>}</div></div></section>
  {selected && <section className="mt-6"><div className="panel"><div className="panel-header"><div><h3 className="section-title">Live patient detail · {selected.name}</h3><p className="section-subtitle">{selected.id} · sequence {selected.sequence}</p></div><StatusBadge status={selected.status} /></div><div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4"><Metric icon={HeartPulse} label="Heart rate" value={selected.hr} unit="bpm" tone="cyan" /><Metric icon={Activity} label="SpO₂" value={selected.spo2} unit="%" tone="violet" /><Metric icon={Thermometer} label="Temperature" value={selected.temp} unit="°C" tone="amber" /><Metric icon={Signal} label="Signal quality" value={Math.round(selected.signal * 100)} unit="%" tone="emerald" /></div><div className="border-t border-white/[.06] p-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-medium text-slate-300">Telemetry trend</p><div className="flex gap-1">{(['hr','spo2','temp'] as MetricKey[]).map(k => <button key={k} onClick={() => setMetric(k)} className={`rounded px-2 py-1 font-mono text-[10px] uppercase ${metric === k ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-500 hover:text-slate-300'}`}>{k}</button>)}</div></div><TrendChart history={selectedHistory} metric={metric} /></div></div></section>}
  <p className="mt-8 text-center text-[10px] leading-relaxed text-slate-600">EDUCATIONAL PROTOTYPE · SIMULATED, NON-CLINICAL DATA · NOT FOR DIAGNOSIS OR TREATMENT<br />Mesh/Monitor visualizes sensor telemetry for academic demonstration only.</p></main></div></div>
}

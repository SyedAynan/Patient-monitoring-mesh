'use client'

import { useState, useCallback, useMemo } from 'react'
import { Droplets, Heart, Thermometer, Wind, Scan } from 'lucide-react'
import { ECGWaveformCanvas } from './ecg-canvas'
import { HologramHuman3D } from './hologram-human-3d'
import { monitorAudio } from '@/lib/audio'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type VitalKey = 'hr' | 'spo2' | 'rr' | 'temp'
type VitalStatus = 'normal' | 'warning' | 'critical'

interface AnatomicalBodyProps {
  patientId: string
  room: string
  hr: number
  spo2: number
  temp: number
  rr: number
  status?: string
  activeMarker?: VitalKey | null
  onMarkerSelect?: (vital: VitalKey | null) => void
}

// ---------------------------------------------------------------------------
// Threshold definitions for vital status
// ---------------------------------------------------------------------------
const THRESHOLDS: Record<VitalKey, { warning: [number, number]; critical: [number, number]; normal: string }> = {
  hr:   { warning: [55, 110],  critical: [45, 130],  normal: '60 – 100 bpm' },
  spo2: { warning: [92, 100],  critical: [88, 100],  normal: '95 – 100 %' },
  rr:   { warning: [10, 22],   critical: [8, 28],    normal: '12 – 20 br/min' },
  temp: { warning: [36.0, 37.8], critical: [35.0, 38.5], normal: '36.1 – 37.2 °C' },
}

function getVitalStatusFn(vital: VitalKey, value: number): VitalStatus {
  const t = THRESHOLDS[vital]
  if (value < t.critical[0] || value > t.critical[1]) return 'critical'
  if (value < t.warning[0] || value > t.warning[1]) return 'warning'
  return 'normal'
}

// ---------------------------------------------------------------------------
// Vital detail info panel (shown when marker is clicked)
// ---------------------------------------------------------------------------
const VITAL_INFO: Record<VitalKey, { title: string; icon: typeof Heart; color: string; borderColor: string; bgColor: string; description: string }> = {
  hr:   { title: 'Heart Rate',         icon: Heart,       color: 'text-rose-400',  borderColor: 'border-rose-500/20', bgColor: 'bg-rose-500/5',  description: 'Cardiac rhythm from ECG sensor' },
  spo2: { title: 'Oxygen Saturation',  icon: Droplets,    color: 'text-cyan-400',  borderColor: 'border-cyan-500/20', bgColor: 'bg-cyan-500/5',  description: 'Peripheral SpO₂ via pulse oximeter' },
  rr:   { title: 'Respiratory Rate',   icon: Wind,        color: 'text-violet-400',  borderColor: 'border-violet-500/20', bgColor: 'bg-violet-500/5',  description: 'Thoracic impedance breath rate' },
  temp: { title: 'Body Temperature',   icon: Thermometer, color: 'text-amber-400', borderColor: 'border-amber-500/20', bgColor: 'bg-amber-500/5', description: 'Core temperature thermistor' },
}

const VITAL_UNITS: Record<VitalKey, string> = { hr: 'bpm', spo2: '%', rr: 'br/min', temp: '°C' }

// ---------------------------------------------------------------------------
// Status color helpers
// ---------------------------------------------------------------------------
function statusBorderClass(s: VitalStatus): string {
  if (s === 'critical') return 'border-rose-500/20'
  if (s === 'warning')  return 'border-amber-500/20'
  return ''
}

function statusTextClass(s: VitalStatus): string {
  if (s === 'critical') return 'text-rose-400'
  if (s === 'warning')  return 'text-amber-400'
  return 'text-emerald-400'
}

function statusLabel(s: VitalStatus): string {
  if (s === 'critical') return 'CRITICAL'
  if (s === 'warning')  return 'WARNING'
  return 'NORMAL'
}

// ---------------------------------------------------------------------------
// Main Component — Single unified view (no tabs)
// ---------------------------------------------------------------------------
export function AnatomicalBodyHologram({
  patientId = 'P-0001',
  room = 'Room 101 · Bed 1',
  hr = 74,
  spo2 = 97.7,
  temp = 36.6,
  rr = 16,
  status,
  activeMarker: activeMarkerProp,
  onMarkerSelect,
}: AnatomicalBodyProps) {
  const [internalActiveMarker, setInternalActiveMarker] = useState<VitalKey | null>(null)
  const activeMarker = activeMarkerProp !== undefined ? activeMarkerProp : internalActiveMarker

  // Format patient ID
  const displayId = patientId.startsWith('P-')
    ? patientId
    : `P-000${patientId.replace('patient-0', '').replace('patient-', '')}`

  // Vital values map
  const vitals: Record<VitalKey, number> = useMemo(() => ({ hr, spo2, rr, temp }), [hr, spo2, rr, temp])

  // Status getter using thresholds
  const getVitalStatus = useCallback((vital: VitalKey): VitalStatus => {
    return getVitalStatusFn(vital, vitals[vital])
  }, [vitals])

  // Handle marker click from 3D scene
  const handleMarkerClick = useCallback((vital: VitalKey) => {
    const next = activeMarker === vital ? null : vital
    if (onMarkerSelect) {
      onMarkerSelect(next)
    } else {
      setInternalActiveMarker(next)
    }
  }, [activeMarker, onMarkerSelect])

  // Heart pulse duration
  const pulseDuration = `${(60 / Math.max(40, hr)).toFixed(2)}s`

  // Overall patient status badge
  const overallStatus = useMemo(() => {
    const statuses = (['hr', 'spo2', 'rr', 'temp'] as VitalKey[]).map(v => getVitalStatus(v))
    if (statuses.includes('critical')) return 'critical'
    if (statuses.includes('warning')) return 'warning'
    return 'normal'
  }, [getVitalStatus])

  const statusBadgeClasses = {
    normal:   'border-emerald-500/20 bg-emerald-500/6 text-emerald-400',
    warning:  'border-amber-500/20 bg-amber-500/6 text-amber-400',
    critical: 'border-rose-500/20 bg-rose-500/6 text-rose-400',
  }

  return (
    <div
      className="flex flex-col h-full rounded-xl border border-border overflow-hidden"
      style={{ background: 'var(--card)' }}
      role="region"
      aria-label="Patient anatomical visualization"
    >

      {/* ================================================================ */}
      {/* Header */}
      {/* ================================================================ */}
      <div className="px-3.5 pt-3 pb-2 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">Patient Visualization</p>
          <span className={`rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusBadgeClasses[overallStatus]}`}>
            {statusLabel(overallStatus)}
          </span>
        </div>
        <h3 className="text-sm font-semibold tracking-tight text-white mt-0.5">Patient {displayId}</h3>
        <p className="text-[11px] font-mono text-slate-500 mt-0.5">{room}</p>
      </div>

      {/* ================================================================ */}
      {/* Unified Content: 3D Model + Vitals + ECG — all in one view */}
      {/* ================================================================ */}
      <div className="flex-1 flex flex-col min-h-0 px-3 pt-2 pb-3 gap-2">

        {/* Organ Target Scan Selector Bar */}
        <div className="flex items-center gap-1 border border-border rounded-lg p-1 text-[9px] font-mono flex-shrink-0" style={{ background: 'var(--background)' }}>
          <span className="text-cyan-400 px-1.5 font-semibold flex items-center gap-1">
            <Scan className="size-3 text-cyan-400" aria-hidden="true" /> TARGET:
          </span>
          {(['hr', 'spo2', 'rr', 'temp'] as const).map(vKey => (
            <button
              key={vKey}
              onClick={() => {
                monitorAudio.playScanSound()
                handleMarkerClick(vKey)
              }}
              className={`flex-1 py-1 rounded-md transition-colors text-center uppercase font-mono ${
                activeMarker === vKey
                  ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] border border-transparent'
              }`}
              aria-label={`Focus on ${vKey === 'hr' ? 'heart rate' : vKey === 'spo2' ? 'oxygen saturation' : vKey === 'rr' ? 'respiration' : 'temperature'}`}
              aria-pressed={activeMarker === vKey}
            >
              {vKey === 'hr' ? '❤ Heart' : vKey === 'spo2' ? '○ SpO₂' : vKey === 'rr' ? '◎ Resp' : '◇ Temp'}
            </button>
          ))}
        </div>

        {/* 3D Model Canvas */}
        <div className="flex-1 min-h-[220px] rounded-lg overflow-hidden border border-border">
          <HologramHuman3D
            hr={hr}
            spo2={spo2}
            temp={temp}
            rr={rr}
            activeMarker={activeMarker}
            onMarkerClick={handleMarkerClick}
            getVitalStatus={getVitalStatus}
          />
        </div>

        {/* Marker Detail Panel (shown when a marker is clicked) */}
        {activeMarker && (
          <div
            className={`rounded-lg border ${VITAL_INFO[activeMarker].borderColor} ${VITAL_INFO[activeMarker].bgColor} p-2.5 transition-all flex-shrink-0`}
            role="region"
            aria-label={`${VITAL_INFO[activeMarker].title} detail`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = VITAL_INFO[activeMarker].icon
                  return <Icon className={`size-3.5 ${VITAL_INFO[activeMarker].color}`} aria-hidden="true" />
                })()}
                <div>
                  <p className={`text-[11px] font-semibold ${VITAL_INFO[activeMarker].color}`}>{VITAL_INFO[activeMarker].title}</p>
                  <p className="text-[9px] text-slate-600 font-mono">{VITAL_INFO[activeMarker].description}</p>
                </div>
              </div>
              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-lg font-bold text-white">{vitals[activeMarker]}</span>
                <span className="text-[10px] text-slate-500">{VITAL_UNITS[activeMarker]}</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border">
              <span className="text-[9px] font-mono text-slate-600">Normal: {THRESHOLDS[activeMarker].normal}</span>
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${statusTextClass(getVitalStatus(activeMarker))}`}>
                {statusLabel(getVitalStatus(activeMarker))}
              </span>
            </div>
          </div>
        )}

        {/* Status Legend */}
        <div className="flex items-center justify-center gap-4 text-[9px] font-mono flex-shrink-0">
          <div className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="text-slate-500">Normal</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-400" aria-hidden="true" />
            <span className="text-slate-500">Attention</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
            <span className="text-slate-500">Critical</span>
          </div>
        </div>

        {/* Compact Vital Summary Strip */}
        <div className="grid grid-cols-4 gap-1.5 flex-shrink-0">
          {(['hr', 'spo2', 'rr', 'temp'] as VitalKey[]).map(key => {
            const info = VITAL_INFO[key]
            const Icon = info.icon
            const vitalStatus = getVitalStatus(key)
            const isActive = activeMarker === key
            return (
              <button
                key={key}
                onClick={() => handleMarkerClick(key)}
                className={`flex flex-col items-center gap-0.5 rounded-lg border p-1.5 transition-colors ${
                  isActive
                    ? `${info.borderColor} ${info.bgColor}`
                    : `border-border hover:border-slate-700/60 ${statusBorderClass(vitalStatus)}`
                }`}
                aria-label={`${info.title}: ${vitals[key]} ${VITAL_UNITS[key]}`}
              >
                <Icon className={`size-3 ${info.color} ${key === 'hr' ? 'animate-live-pulse' : ''}`} style={key === 'hr' ? { animationDuration: pulseDuration } : {}} aria-hidden="true" />
                <span className="font-mono text-xs font-bold text-white">{vitals[key]}</span>
                <span className="text-[7px] font-mono text-slate-600 uppercase">{VITAL_UNITS[key]}</span>
              </button>
            )
          })}
        </div>

        {/* ECG Rhythm Lead II */}
        <div className="rounded-lg border border-border p-2.5 flex-shrink-0" style={{ background: 'var(--background)' }}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-semibold tracking-wider text-slate-400 uppercase text-[9px]">Rhythm Lead II</span>
            <span className="font-mono text-[9px] font-medium text-emerald-400 flex items-center gap-1">
              <span className="size-1 rounded-full bg-emerald-400 animate-live-pulse" aria-hidden="true" />
              {hr} bpm
            </span>
          </div>
          <div className="relative rounded-md overflow-hidden border border-border">
            <div
              className="absolute inset-0 opacity-10 pointer-events-none"
              style={{
                backgroundImage: 'linear-gradient(rgba(148, 163, 184, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.2) 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
              aria-hidden="true"
            />
            <ECGWaveformCanvas height={36} color="#22d3ee" hr={hr} spo2={spo2} status={status} enableBeep={false} />
          </div>
        </div>
      </div>
    </div>
  )
}

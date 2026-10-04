'use client'

import { useState, useCallback, useMemo } from 'react'
import { Droplets, Heart, Thermometer, Wind, Scan, Sparkles } from 'lucide-react'
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
  hr:   { title: 'Heart Rate',         icon: Heart,       color: 'text-rose-400',  borderColor: 'border-rose-500/30', bgColor: 'bg-rose-500/10',  description: 'Cardiac rhythm from ECG sensor' },
  spo2: { title: 'Oxygen Saturation',  icon: Droplets,    color: 'text-cyan-400',  borderColor: 'border-cyan-500/30', bgColor: 'bg-cyan-500/10',  description: 'Peripheral SpO₂ via pulse oximeter' },
  rr:   { title: 'Respiratory Rate',   icon: Wind,        color: 'text-blue-400',  borderColor: 'border-blue-500/30', bgColor: 'bg-blue-500/10',  description: 'Thoracic impedance breath rate' },
  temp: { title: 'Body Temperature',   icon: Thermometer, color: 'text-amber-400', borderColor: 'border-amber-500/30', bgColor: 'bg-amber-500/10', description: 'Core temperature thermistor' },
}

const VITAL_UNITS: Record<VitalKey, string> = { hr: 'bpm', spo2: '%', rr: 'br/min', temp: '°C' }

// ---------------------------------------------------------------------------
// Status color helpers
// ---------------------------------------------------------------------------
function statusGlowClass(s: VitalStatus): string {
  if (s === 'critical') return 'shadow-[0_0_10px_rgba(244,63,94,0.4)] border-rose-500/40'
  if (s === 'warning')  return 'shadow-[0_0_10px_rgba(251,191,36,0.3)] border-amber-500/35'
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
  room = 'Room 101 • Bed 1',
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
    normal:   'border-emerald-500/35 bg-emerald-500/12 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]',
    warning:  'border-amber-500/35 bg-amber-500/12 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.2)]',
    critical: 'border-rose-500/35 bg-rose-500/12 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.2)] animate-pulse',
  }

  return (
    <div className="flex flex-col h-full rounded-2xl border border-cyan-500/15 backdrop-blur-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(3,14,38,0.9) 0%, rgba(2,8,23,0.95) 50%, rgba(1,4,15,0.98) 100%)', boxShadow: '0 16px 48px rgba(0,0,0,0.7), inset 0 1px 0 rgba(56,189,248,0.06)' }}>

      {/* ================================================================ */}
      {/* Header */}
      {/* ================================================================ */}
      <div className="px-4 pt-4 pb-2.5 border-b border-white/8 flex-shrink-0">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-400">PATIENT DETAIL</p>
          <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${statusBadgeClasses[overallStatus]}`}>
            {statusLabel(overallStatus)}
          </span>
        </div>
        <h3 className="text-base font-bold tracking-tight text-white mt-0.5">Patient {displayId}</h3>
        <p className="text-[11px] font-mono text-slate-400 mt-0.5">{room}</p>
      </div>

      {/* ================================================================ */}
      {/* Unified Content: 3D Model + Vitals + ECG — all in one view */}
      {/* ================================================================ */}
      <div className="flex-1 flex flex-col min-h-0 px-3 pt-2 pb-3 gap-2.5">

        {/* Real-time Organ Target Scan Reticle Bar */}
        <div className="flex items-center gap-1 bg-black/40 border border-white/8 rounded-xl p-1 text-[9px] font-mono flex-shrink-0">
          <span className="text-cyan-400 px-1 font-bold flex items-center gap-1">
            <Scan className="size-3 text-cyan-400 animate-pulse" /> TARGET:
          </span>
          {(['hr', 'spo2', 'rr', 'temp'] as const).map(vKey => (
            <button
              key={vKey}
              onClick={() => {
                monitorAudio.playScanSound()
                setActiveMarker(activeMarker === vKey ? null : vKey)
              }}
              className={`flex-1 py-1 rounded-lg transition-all text-center uppercase font-mono ${
                activeMarker === vKey
                  ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40 font-bold shadow-[0_0_10px_rgba(34,211,238,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {vKey === 'hr' ? '🫀 Heart' : vKey === 'spo2' ? '🫁 SpO₂' : vKey === 'rr' ? '🫁 Resp' : '🌡️ Temp'}
            </button>
          ))}
        </div>

        {/* 3D Model Canvas */}
        <div className="flex-1 min-h-[240px] rounded-xl overflow-hidden">
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
            className={`rounded-xl border ${VITAL_INFO[activeMarker].borderColor} ${VITAL_INFO[activeMarker].bgColor} p-2.5 backdrop-blur-md transition-all flex-shrink-0`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = VITAL_INFO[activeMarker].icon
                  return <Icon className={`size-3.5 ${VITAL_INFO[activeMarker].color}`} />
                })()}
                <div>
                  <p className={`text-[11px] font-bold ${VITAL_INFO[activeMarker].color}`}>{VITAL_INFO[activeMarker].title}</p>
                  <p className="text-[8px] text-slate-500 font-mono">{VITAL_INFO[activeMarker].description}</p>
                </div>
              </div>
              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-lg font-bold text-white">{vitals[activeMarker]}</span>
                <span className="text-[10px] text-slate-400">{VITAL_UNITS[activeMarker]}</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/8">
              <span className="text-[8px] font-mono text-slate-500">Normal: {THRESHOLDS[activeMarker].normal}</span>
              <span className={`text-[8px] font-bold uppercase tracking-wider ${statusTextClass(getVitalStatus(activeMarker))}`}>
                {statusLabel(getVitalStatus(activeMarker))}
              </span>
            </div>
          </div>
        )}

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
                className={`flex flex-col items-center gap-0.5 rounded-lg border p-1.5 transition-all ${
                  isActive
                    ? `${info.borderColor} ${info.bgColor} shadow-lg`
                    : `border-white/6 bg-black/30 hover:border-white/15 ${statusGlowClass(vitalStatus)}`
                }`}
              >
                <Icon className={`size-3 ${info.color} ${key === 'hr' ? 'animate-pulse' : ''}`} style={key === 'hr' ? { animationDuration: pulseDuration } : {}} />
                <span className="font-mono text-xs font-bold text-white">{vitals[key]}</span>
                <span className="text-[7px] font-mono text-slate-500 uppercase">{VITAL_UNITS[key]}</span>
              </button>
            )
          })}
        </div>

        {/* ECG Rhythm Lead II */}
        <div className="rounded-xl border border-teal-500/15 p-2.5 flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgba(1,6,18,0.9) 0%, rgba(1,6,18,0.85) 100%)', boxShadow: 'inset 0 0 16px rgba(20,184,166,0.06)' }}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-bold tracking-wider text-slate-200 uppercase text-[9px]">RHYTHM LEAD II</span>
            <span className="font-mono text-[9px] font-semibold text-emerald-400 flex items-center gap-1">
              <span className="size-1 rounded-full bg-emerald-400 animate-ping" />
              {hr} bpm
            </span>
          </div>
          <div className="relative rounded-lg overflow-hidden border border-teal-500/10 bg-black/80">
            <div
              className="absolute inset-0 opacity-15 pointer-events-none"
              style={{
                backgroundImage: 'linear-gradient(rgba(45, 212, 191, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(45, 212, 191, 0.3) 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
            />
            <ECGWaveformCanvas height={36} color="#2dd4bf" hr={hr} spo2={spo2} status={status} enableBeep={false} />
          </div>
        </div>
      </div>
    </div>
  )
}

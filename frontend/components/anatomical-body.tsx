'use client'

import { Activity, Droplets, Heart, Thermometer, Wind } from 'lucide-react'
import { ECGWaveformCanvas } from './ecg-canvas'

interface AnatomicalBodyProps {
  patientId: string
  room: string
  hr: number
  spo2: number
  temp: number
  rr: number
  status?: string
}

export function AnatomicalBodyHologram({
  patientId = 'P-0001',
  room = 'Room 101 • Bed 1',
  hr = 74,
  spo2 = 97.7,
  temp = 36.6,
  rr = 16,
}: AnatomicalBodyProps) {
  // Format patient ID dynamically: 'patient-01' -> 'P-0001'
  const displayId = patientId.startsWith('P-')
    ? patientId
    : `P-000${patientId.replace('patient-0', '').replace('patient-', '')}`

  // Dynamic heart pulse duration based on heart rate bpm
  const pulseDuration = `${(60 / Math.max(40, hr)).toFixed(2)}s`

  return (
    <div className="flex flex-col h-full justify-between rounded-3xl border border-cyan-500/30 bg-gradient-to-b from-[#030e26] via-[#020817] to-[#01040f] p-5 sm:p-6 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
      {/* ==================================================================== */}
      {/* 1. Header: Top-Left Patient Details (Dynamic HTML) */}
      {/* ==================================================================== */}
      <div className="mb-4 border-b border-white/10 pb-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">PATIENT DETAIL</p>
        <h3 className="text-xl font-bold tracking-tight text-white mt-0.5">Patient {displayId}</h3>
        <p className="text-xs font-mono text-slate-400 mt-1">{room}</p>
      </div>

      {/* ==================================================================== */}
      {/* 2. Main Middle Section: Holographic Human Body & Vital Signs Stack */}
      {/* ==================================================================== */}
      <div className="my-2 grid grid-cols-1 md:grid-cols-[1.15fr_1fr] items-center gap-5">
        
        {/* FULL-BODY HOLOGRAPHIC HUMAN DIGITAL TWIN VISUALIZATION AREA */}
        <div className="relative flex flex-col items-center justify-center py-4 px-2 overflow-hidden rounded-2xl bg-cyan-950/20 border border-cyan-500/20 shadow-[inset_0_0_35px_rgba(56,189,248,0.08)] min-h-[250px]">
          
          {/* Background Soft Neon Cyan Aura Glow */}
          <div className="absolute inset-0 m-auto size-52 rounded-full bg-cyan-500/15 blur-3xl animate-pulse" />

          {/* Animated Vertical Scanning Line Sweep */}
          <div
            className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent pointer-events-none z-20 animate-pulse"
            style={{
              top: '38%',
              boxShadow: '0 0 15px rgba(56, 189, 248, 0.9)',
            }}
          />

          {/* Premium Holographic Human Digital Twin Image Asset */}
          <div className="relative z-10 flex justify-center items-center h-[230px] w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/holographic-human-body.png"
              alt="Holographic Human Digital Twin"
              className="h-full w-auto object-contain mix-blend-screen drop-shadow-[0_0_20px_rgba(56,189,248,0.6)]"
            />

            {/* Dynamic Pulsing Heart Marker Overlay over Anatomical Heart */}
            <div className="absolute top-[28%] left-[46%] -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
              <span
                className="absolute -inset-2 rounded-full bg-rose-500 opacity-75 animate-ping"
                style={{ animationDuration: pulseDuration }}
              />
              <span
                className="relative grid size-3.5 place-items-center rounded-full bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-pulse"
                style={{ animationDuration: pulseDuration }}
              >
                <Heart className="size-2 text-white fill-white" />
              </span>
            </div>
          </div>
        </div>

        {/* VITAL SIGNS VERTICAL STACK (DYNAMIC HTML REACT ELEMENTS) */}
        <div className="flex flex-col gap-3.5">
          {/* 1. HR — Heart Rate */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full border border-rose-500/30 bg-rose-500/15 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]">
                <Heart className="size-4 animate-pulse fill-rose-500/30" style={{ animationDuration: pulseDuration }} />
              </span>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">HR</span>
                <span className="text-xs text-slate-500">Heart Rate</span>
              </div>
            </div>
            <div className="flex items-baseline gap-1.5 font-mono">
              <span className="text-2xl font-bold tracking-tight text-white">{hr}</span>
              <span className="text-xs font-medium text-slate-400">bpm</span>
            </div>
          </div>

          {/* 2. SpO₂ — Oxygen Saturation */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full border border-cyan-500/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(56,189,248,0.3)]">
                <Droplets className="size-4 fill-cyan-400/30" />
              </span>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">SpO₂</span>
                <span className="text-xs text-slate-500">Oxygen Saturation</span>
              </div>
            </div>
            <div className="flex items-baseline gap-1.5 font-mono">
              <span className="text-2xl font-bold tracking-tight text-white">{spo2}</span>
              <span className="text-xs font-medium text-slate-400">%</span>
            </div>
          </div>

          {/* 3. RR — Respiration Rate */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full border border-blue-500/30 bg-blue-500/15 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.3)]">
                <Wind className="size-4" />
              </span>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">RR</span>
                <span className="text-xs text-slate-500">Respiration Rate</span>
              </div>
            </div>
            <div className="flex items-baseline gap-1.5 font-mono">
              <span className="text-2xl font-bold tracking-tight text-white">{rr}</span>
              <span className="text-xs font-medium text-slate-400">br/min</span>
            </div>
          </div>

          {/* 4. TEMP — Body Temp */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]">
                <Thermometer className="size-4" />
              </span>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">TEMP</span>
                <span className="text-xs text-slate-500">Body Temp</span>
              </div>
            </div>
            <div className="flex items-baseline gap-1.5 font-mono">
              <span className="text-2xl font-bold tracking-tight text-white">{temp}</span>
              <span className="text-xs font-medium text-slate-400">°C</span>
            </div>
          </div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* 3. Bottom Section: Dedicated ECG Monitoring Panel (Dynamic HTML & Canvas) */}
      {/* ==================================================================== */}
      <div className="mt-4 rounded-2xl border border-teal-500/25 bg-[#010612]/90 p-3.5 shadow-[inset_0_0_20px_rgba(20,184,166,0.08)]">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-bold tracking-wider text-slate-200 uppercase">RHYTHM LEAD II</span>
          <span className="font-mono text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
            1 mV/cm
          </span>
        </div>
        
        {/* ECG Waveform Canvas with Teal Glowing Trace Line */}
        <div className="relative rounded-lg overflow-hidden border border-teal-500/15 bg-black/80">
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(rgba(45, 212, 191, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(45, 212, 191, 0.3) 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          />
          <ECGWaveformCanvas height={46} color="#2dd4bf" hr={hr} enableBeep={false} />
        </div>
      </div>
    </div>
  )
}

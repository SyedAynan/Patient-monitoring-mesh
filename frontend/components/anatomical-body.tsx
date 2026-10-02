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
  room = 'Room 101  •  Bed 1',
  hr = 74,
  spo2 = 98.1,
  temp = 36.7,
  rr = 16,
}: AnatomicalBodyProps) {
  // Format patient ID nicely if passed as patient-01 -> P-0001
  const displayId = patientId.startsWith('P-')
    ? patientId
    : `P-000${patientId.replace('patient-0', '').replace('patient-', '')}`

  return (
    <div className="flex flex-col h-full justify-between rounded-3xl border border-cyan-500/25 bg-gradient-to-b from-[#030e26] via-[#020817] to-[#01040f] p-5 sm:p-6 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
      {/* ==================================================================== */}
      {/* 1. Header: Top-Left Patient Details */}
      {/* ==================================================================== */}
      <div className="mb-4 border-b border-white/10 pb-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">PATIENT DETAIL</p>
        <h3 className="text-xl font-bold tracking-tight text-white mt-0.5">Patient {displayId}</h3>
        <p className="text-xs font-mono text-slate-400 mt-1">{room}</p>
      </div>

      {/* ==================================================================== */}
      {/* 2. Main Middle Section: Holographic Human Body & Vital Signs Stack */}
      {/* ==================================================================== */}
      <div className="my-2 grid grid-cols-1 md:grid-cols-[1.1fr_1fr] items-center gap-5">
        
        {/* HOLOGRAPHIC HUMAN BODY DIGITAL TWIN */}
        <div className="relative flex flex-col items-center justify-center py-4 px-2 overflow-hidden rounded-2xl bg-cyan-950/10 border border-cyan-500/10">
          {/* Soft Background Neon Aura Glow */}
          <div className="absolute inset-0 m-auto size-44 rounded-full bg-cyan-500/10 blur-2xl animate-pulse" />
          
          <svg
            width="140"
            height="230"
            viewBox="0 0 140 230"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="relative z-10 drop-shadow-[0_0_18px_rgba(56,189,248,0.45)]"
          >
            <defs>
              {/* Holographic Cyan Linear Gradient */}
              <linearGradient id="holoGradient" x1="70" y1="0" x2="70" y2="210" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
                <stop offset="50%" stopColor="#0284c7" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#0369a1" stopOpacity="0.5" />
              </linearGradient>
              
              {/* Internal Body Wireframe Grid Pattern */}
              <pattern id="bodyWireframeGrid" width="8" height="8" patternUnits="userSpaceOnUse">
                <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="0.5" />
              </pattern>
            </defs>

            {/* Anatomical Human Body Silhouette */}
            <g opacity="0.95">
              {/* Head */}
              <circle cx="70" cy="24" r="15" stroke="url(#holoGradient)" strokeWidth="1.8" fill="rgba(56, 189, 248, 0.08)" />
              <path d="M 62 24 H 78 M 70 16 V 32" stroke="rgba(56, 189, 248, 0.3)" strokeWidth="0.8" />

              {/* Neck & Shoulders */}
              <path d="M 64 38 L 76 38 L 78 46 L 62 46 Z" stroke="url(#holoGradient)" strokeWidth="1.5" fill="rgba(56, 189, 248, 0.12)" />

              {/* Torso & Chest Contour */}
              <path
                d="M 44 50 L 96 50 L 88 125 L 52 125 Z"
                stroke="url(#holoGradient)"
                strokeWidth="2"
                fill="url(#bodyWireframeGrid)"
              />
              <path d="M 70 50 V 125 M 48 74 H 92 M 50 98 H 90" stroke="rgba(56, 189, 248, 0.35)" strokeWidth="1" strokeDasharray="2 2" />

              {/* Left & Right Arms */}
              <path d="M 44 50 L 22 85 L 26 135" stroke="url(#holoGradient)" strokeWidth="2" strokeLinecap="round" />
              <path d="M 96 50 L 118 85 L 114 135" stroke="url(#holoGradient)" strokeWidth="2" strokeLinecap="round" />
              <circle cx="26" cy="135" r="3" stroke="#38bdf8" strokeWidth="1" fill="rgba(56, 189, 248, 0.3)" />
              <circle cx="114" cy="135" r="3" stroke="#38bdf8" strokeWidth="1" fill="rgba(56, 189, 248, 0.3)" />

              {/* Pelvis & Legs */}
              <path d="M 52 125 L 62 205 M 88 125 L 78 205" stroke="url(#holoGradient)" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M 70 125 V 205" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="1" strokeDasharray="3 3" />
              
              {/* Feet */}
              <path d="M 58 205 L 54 210 H 64 Z M 82 205 L 86 210 H 76 Z" fill="rgba(56, 189, 248, 0.4)" stroke="#38bdf8" strokeWidth="1" />
            </g>

            {/* Pulsing Anatomical Heart Indicator (Left Chest) */}
            <g transform="translate(62, 68)">
              {/* Soft Pink/Red Heart Aura Pulse */}
              <circle cx="0" cy="0" r="9" fill="#f43f5e" className="animate-ping opacity-60" />
              <circle cx="0" cy="0" r="5" fill="#f43f5e" className="animate-pulse" />
              {/* Vector Heart Shape */}
              <path
                d="M 0 -3 C -2 -6, -6 -4, -6 -1 C -6 3, 0 6, 0 8 C 0 6, 6 3, 6 -1 C 6 -4, 2 -6, 0 -3 Z"
                fill="#ffffff"
                transform="scale(0.85)"
              />
            </g>

            {/* Circular Scanning Platform Beneath Feet */}
            <g transform="translate(70, 215)">
              <ellipse cx="0" cy="0" rx="42" ry="10" stroke="#38bdf8" strokeWidth="1.5" fill="rgba(56, 189, 248, 0.05)" className="animate-pulse" />
              <ellipse cx="0" cy="0" rx="28" ry="6.5" stroke="rgba(56, 189, 248, 0.5)" strokeWidth="1" strokeDasharray="4 2" />
              <line x1="-42" y1="0" x2="42" y2="0" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" />
              <line x1="0" y1="-10" x2="0" y2="10" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" />
              {/* Scan Particles */}
              <circle cx="-18" cy="-2" r="1.5" fill="#38bdf8" className="animate-ping" />
              <circle cx="20" cy="2" r="1.5" fill="#38bdf8" className="animate-ping" />
            </g>
          </svg>
        </div>

        {/* VITAL SIGNS VERTICAL STACK */}
        <div className="flex flex-col gap-3">
          {/* 1. Heart Rate (HR) */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full border border-rose-500/30 bg-rose-500/15 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]">
                <Heart className="size-4 animate-pulse fill-rose-500/30" />
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

          {/* 2. SpO2 */}
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

          {/* 3. Respiratory Rate (RR) */}
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

          {/* 4. Temperature (TEMP) */}
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
      {/* 3. Bottom Section: Dedicated ECG Monitoring Panel */}
      {/* ==================================================================== */}
      <div className="mt-4 rounded-2xl border border-teal-500/25 bg-[#010612]/90 p-3.5 shadow-[inset_0_0_20px_rgba(20,184,166,0.08)]">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-bold tracking-wider text-slate-200 uppercase">RHYTHM LEAD II</span>
          <span className="font-mono text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
            ● 1 mV/cm
          </span>
        </div>
        
        {/* ECG Waveform Canvas with Teal Glowing Trace Line */}
        <div className="relative rounded-lg overflow-hidden border border-teal-500/15 bg-black/80">
          {/* Subtle Grid Background Overlay */}
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

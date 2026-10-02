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
      <div className="my-2 grid grid-cols-1 md:grid-cols-[1.15fr_1fr] items-center gap-5">
        
        {/* FULL-BODY HOLOGRAPHIC HUMAN DIGITAL TWIN */}
        <div className="relative flex flex-col items-center justify-center py-4 px-2 overflow-hidden rounded-2xl bg-cyan-950/15 border border-cyan-500/15 shadow-[inset_0_0_30px_rgba(56,189,248,0.05)]">
          {/* Soft Background Neon Cyan Aura Glow */}
          <div className="absolute inset-0 m-auto size-48 rounded-full bg-cyan-500/10 blur-2xl animate-pulse" />

          {/* Animated Vertical Scan Line Sweep */}
          <div
            className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent pointer-events-none animate-pulse"
            style={{
              top: '30%',
              boxShadow: '0 0 15px rgba(56, 189, 248, 0.8)',
            }}
          />

          <svg
            width="150"
            height="240"
            viewBox="0 0 140 240"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="relative z-10 drop-shadow-[0_0_20px_rgba(56,189,248,0.5)]"
          >
            <defs>
              {/* Holographic Cyan Linear Gradient */}
              <linearGradient id="holoGradient" x1="70" y1="0" x2="70" y2="230" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
                <stop offset="50%" stopColor="#0284c7" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#0369a1" stopOpacity="0.6" />
              </linearGradient>

              {/* Wireframe Internal Grid Pattern */}
              <pattern id="humanGrid" width="6" height="6" patternUnits="userSpaceOnUse">
                <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="0.5" />
              </pattern>
            </defs>

            {/* ANATOMICALLY RECOGNIZABLE FULL HUMAN BODY SILHOUETTE */}
            <g opacity="0.95">
              {/* Head & Cranium */}
              <path
                d="M 70 8 C 61 8, 56 14, 56 24 C 56 34, 62 38, 70 38 C 78 38, 84 34, 84 24 C 84 14, 79 8, 70 8 Z"
                stroke="url(#holoGradient)"
                strokeWidth="1.8"
                fill="rgba(56, 189, 248, 0.08)"
              />
              <path d="M 60 24 H 80 M 70 12 V 34" stroke="rgba(56, 189, 248, 0.35)" strokeWidth="0.8" />

              {/* Neck & Trapezius */}
              <path
                d="M 64 36 L 64 44 C 64 45, 52 49, 44 54 M 76 36 L 76 44 C 76 45, 88 49, 96 54"
                stroke="url(#holoGradient)"
                strokeWidth="1.8"
                fill="none"
              />

              {/* Anatomical Torso (Chest, Ribcage, Waist, Pelvis) */}
              <path
                d="M 44 54 C 44 54, 54 62, 70 62 C 86 62, 96 54, 96 54 C 98 75, 94 95, 90 112 C 86 125, 80 132, 70 132 C 60 132, 54 125, 50 112 C 46 95, 42 75, 44 54 Z"
                stroke="url(#holoGradient)"
                strokeWidth="2"
                fill="url(#humanGrid)"
              />

              {/* Internal Ribcage & Spinal Grid Lines */}
              <path d="M 70 44 V 132" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" strokeDasharray="3 2" />
              <path d="M 52 70 C 60 76, 80 76, 88 70" stroke="rgba(56, 189, 248, 0.3)" strokeWidth="1" />
              <path d="M 54 85 C 62 90, 78 90, 86 85" stroke="rgba(56, 189, 248, 0.3)" strokeWidth="1" />
              <path d="M 56 100 C 63 104, 77 104, 84 100" stroke="rgba(56, 189, 248, 0.3)" strokeWidth="1" />

              {/* Left Arm (Shoulder, Deltoid, Bicep, Forearm, Hand) */}
              <path
                d="M 44 54 C 36 58, 30 70, 26 90 C 23 105, 20 122, 18 142 C 17 148, 15 154, 15 158"
                stroke="url(#holoGradient)"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
              <path d="M 50 64 C 42 75, 36 95, 30 120 C 27 135, 24 148, 22 156" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" fill="none" />
              <circle cx="15" cy="158" r="3" stroke="#38bdf8" strokeWidth="1" fill="rgba(56, 189, 248, 0.3)" />

              {/* Right Arm (Shoulder, Deltoid, Bicep, Forearm, Hand) */}
              <path
                d="M 96 54 C 104 58, 110 70, 114 90 C 117 105, 120 122, 122 142 C 123 148, 125 154, 125 158"
                stroke="url(#holoGradient)"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
              <path d="M 90 64 C 98 75, 104 95, 110 120 C 113 135, 116 148, 118 156" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" fill="none" />
              <circle cx="125" cy="158" r="3" stroke="#38bdf8" strokeWidth="1" fill="rgba(56, 189, 248, 0.3)" />

              {/* Left Leg (Thigh, Knee, Calf, Ankle, Foot) */}
              <path
                d="M 52 130 C 50 148, 52 170, 56 188 C 58 198, 57 210, 55 222 L 48 226 H 60 Z"
                stroke="url(#holoGradient)"
                strokeWidth="2"
                fill="rgba(56, 189, 248, 0.08)"
              />

              {/* Right Leg (Thigh, Knee, Calf, Ankle, Foot) */}
              <path
                d="M 88 130 C 90 148, 88 170, 84 188 C 82 198, 83 210, 85 222 L 92 226 H 80 Z"
                stroke="url(#holoGradient)"
                strokeWidth="2"
                fill="rgba(56, 189, 248, 0.08)"
              />

              {/* Knee Joint Nodes */}
              <circle cx="56" cy="186" r="3" stroke="#38bdf8" strokeWidth="1" fill="rgba(56, 189, 248, 0.3)" />
              <circle cx="84" cy="186" r="3" stroke="#38bdf8" strokeWidth="1" fill="rgba(56, 189, 248, 0.3)" />
            </g>

            {/* INTEGRATED PULSING ANATOMICAL HEART MARKER (LEFT CHEST) */}
            <g transform="translate(63, 72)">
              {/* Soft Pink/Red Heart Aura Pulse */}
              <circle cx="0" cy="0" r="10" fill="#f43f5e" className="animate-ping opacity-60" />
              <circle cx="0" cy="0" r="6" fill="#f43f5e" className="animate-pulse" />
              {/* Vector Heart Icon */}
              <path
                d="M 0 -3 C -2.5 -6, -6 -4, -6 -1 C -6 3, 0 6, 0 8.5 C 0 6, 6 3, 6 -1 C 6 -4, 2.5 -6, 0 -3 Z"
                fill="#ffffff"
                transform="scale(0.9)"
              />
            </g>

            {/* CIRCULAR SCANNING PLATFORM BENEATH FEET */}
            <g transform="translate(70, 228)">
              <ellipse cx="0" cy="0" rx="46" ry="11" stroke="#38bdf8" strokeWidth="1.6" fill="rgba(56, 189, 248, 0.06)" className="animate-pulse" />
              <ellipse cx="0" cy="0" rx="30" ry="7" stroke="rgba(56, 189, 248, 0.6)" strokeWidth="1" strokeDasharray="4 2" />
              <line x1="-46" y1="0" x2="46" y2="0" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" />
              <line x1="0" y1="-11" x2="0" y2="11" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" />
              {/* Scanning Grid Particles */}
              <circle cx="-22" cy="-3" r="1.8" fill="#38bdf8" className="animate-ping" />
              <circle cx="24" cy="3" r="1.8" fill="#38bdf8" className="animate-ping" />
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

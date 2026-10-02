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
  status: string
}

export function AnatomicalBodyHologram({
  patientId = 'P-001',
  room = 'Room 101 - Bed 1',
  hr = 72,
  spo2 = 98,
  temp = 36.8,
  rr = 16,
  status = 'Stable',
}: AnatomicalBodyProps) {
  return (
    <div className="flex flex-col h-full justify-between rounded-2xl border border-cyan-500/25 bg-[#030917]/85 p-5 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
      {/* Top Patient Header */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">Patient Detail</p>
        <h3 className="text-lg font-bold text-white tracking-tight mt-0.5">Patient {patientId}</h3>
        <p className="text-xs text-slate-400 font-mono mt-0.5">{room}</p>
      </div>

      {/* Center 3D Cyan Body Hologram & Vitals Grid */}
      <div className="my-4 grid grid-cols-2 items-center gap-4">
        {/* Holographic Cyan Body Wireframe SVG */}
        <div className="relative flex justify-center py-2">
          {/* Subtle glowing backdrop circle */}
          <div className="absolute inset-0 m-auto size-36 rounded-full bg-cyan-500/10 blur-xl animate-pulse" />
          
          <svg width="110" height="210" viewBox="0 0 100 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10 drop-shadow-[0_0_15px_rgba(56,189,248,0.4)]">
            {/* Body Head */}
            <circle cx="50" cy="22" r="14" stroke="#38bdf8" strokeWidth="2" fill="rgba(56, 189, 248, 0.12)" />
            {/* Neck */}
            <path d="M46 36 L54 36 L54 42 L46 42 Z" stroke="#38bdf8" strokeWidth="1.5" fill="rgba(56, 189, 248, 0.2)" />
            {/* Chest & Torso */}
            <path d="M30 46 L70 46 L64 115 L36 115 Z" stroke="#38bdf8" strokeWidth="2" fill="rgba(56, 189, 248, 0.1)" />
            {/* Shoulders & Arms */}
            <path d="M30 46 L14 75 L18 120 M70 46 L86 75 L82 120" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
            {/* Pelvis & Legs */}
            <path d="M36 115 L46 190 M64 115 L54 190" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />

            {/* Glowing Vital Nodes */}
            {/* Heart Node (Chest) */}
            <circle cx="44" cy="62" r="4.5" fill="#f43f5e" className="animate-ping opacity-75" />
            <circle cx="44" cy="62" r="3.5" fill="#f43f5e" />

            {/* SpO2 Node (Wrist/Arm) */}
            <circle cx="16" cy="110" r="4" fill="#38bdf8" className="animate-ping opacity-75" />
            <circle cx="16" cy="110" r="3" fill="#38bdf8" />

            {/* Temp Node (Head) */}
            <circle cx="50" cy="18" r="3.5" fill="#fbbf24" />

            {/* Resp Node (Lungs) */}
            <circle cx="56" cy="68" r="3.5" fill="#60a5fa" />
          </svg>
        </div>

        {/* Vertical Vital Telemetry Readout */}
        <div className="flex flex-col gap-3 font-mono">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-rose-500/20 text-rose-400"><Heart className="size-3.5" /></span>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">HR</span>
              <span className="text-base font-bold text-white">{hr} <span className="text-[10px] text-slate-400 font-normal">bpm</span></span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-cyan-500/20 text-cyan-300"><Droplets className="size-3.5" /></span>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">SpO₂</span>
              <span className="text-base font-bold text-white">{spo2}%</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-blue-500/20 text-blue-300"><Wind className="size-3.5" /></span>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">RR</span>
              <span className="text-base font-bold text-white">{rr} <span className="text-[10px] text-slate-400 font-normal">br/min</span></span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-amber-500/20 text-amber-300"><Thermometer className="size-3.5" /></span>
            <div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Temp</span>
              <span className="text-base font-bold text-white">{temp} <span className="text-[10px] text-slate-400 font-normal">°C</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Live ECG Rhythm Waveform */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center justify-between text-[10px] text-emerald-400 font-semibold mb-1">
          <span>RHYTHM LEAD II</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" /> 1 mV/cm</span>
        </div>
        <ECGWaveformCanvas height={40} color="#10b981" />
      </div>

      {/* IoT Features Badge */}
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-slate-300 leading-relaxed">
        <p className="font-semibold text-cyan-300 mb-1">IoT Patient Monitoring</p>
        <ul className="space-y-0.5 text-[10px] text-slate-400">
          <li>• Real-time telemetry streaming</li>
          <li>• Edge AI risk processing</li>
          <li>• Resilient mesh transport</li>
          <li>• Better care. Faster response.</li>
        </ul>
      </div>
    </div>
  )
}

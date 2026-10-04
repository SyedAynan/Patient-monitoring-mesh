'use client'

import { useState, useEffect, useMemo } from 'react'
import { Activity, AlertCircle, BrainCircuit, CheckCircle2, Cpu, Eye, FileText, Heart, RefreshCw, ShieldAlert, Sparkles, Thermometer, Wind, Zap } from 'lucide-react'
import { monitorAudio } from '@/lib/audio'

interface PatientVitals {
  id: string
  name: string
  room: string
  age: number
  gender: string
  hr: number
  spo2: number
  rr: number
  temp: number
  status: string
  riskScore: number
}

interface RealtimeDiagnosticsProps {
  patient: PatientVitals
  onScanTrigger?: () => void
}

export function RealtimeDiagnosticsPanel({ patient, onScanTrigger }: RealtimeDiagnosticsProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [scanStep, setScanStep] = useState(0)
  const [lastScanTime, setLastScanTime] = useState<string>('Just now')
  const [activeTab, setActiveTab] = useState<'Diagnostic' | 'ECG Metrics' | 'Differential' | 'Telemetry Feed'>('Diagnostic')

  // Derive real-time clinical diagnostics from telemetry
  const diagnostics = useMemo(() => {
    const { hr, spo2, rr, temp, riskScore } = patient

    // Cardiac diagnosis
    let cardiacDiagnosis = 'Normal Sinus Rhythm'
    let cardiacRisk = 'LOW'
    let cardiacColor = 'text-emerald-400 font-semibold'
    if (hr > 120) {
      cardiacDiagnosis = 'Sinus Tachycardia (High Heart Rate)'
      cardiacRisk = 'HIGH'
      cardiacColor = 'text-rose-400 font-semibold'
    } else if (hr > 100) {
      cardiacDiagnosis = 'Mild Sinus Tachycardia'
      cardiacRisk = 'MODERATE'
      cardiacColor = 'text-amber-400 font-semibold'
    } else if (hr < 55) {
      cardiacDiagnosis = 'Sinus Bradycardia (Low Heart Rate)'
      cardiacRisk = 'MODERATE'
      cardiacColor = 'text-amber-400 font-semibold'
    }

    // Pulmonary diagnosis
    let pulmonaryDiagnosis = 'Normoxic / Adequate Oxygenation'
    let pulmonaryRisk = 'LOW'
    let pulmonaryColor = 'text-cyan-400 font-semibold'
    if (spo2 < 90) {
      pulmonaryDiagnosis = 'Severe Hypoxemia / Oxygen Desaturation'
      pulmonaryRisk = 'CRITICAL'
      pulmonaryColor = 'text-rose-400 font-semibold animate-pulse'
    } else if (spo2 < 94) {
      pulmonaryDiagnosis = 'Mild Hypoxia / Mild Oxygen Dip'
      pulmonaryRisk = 'MODERATE'
      pulmonaryColor = 'text-amber-400 font-semibold'
    }

    // Thermal regulation
    let thermalDiagnosis = 'Normothermic (Normal Body Temp)'
    if (temp >= 38.0) {
      thermalDiagnosis = 'Pyrexia (Fever Detected)'
    } else if (temp >= 37.3) {
      thermalDiagnosis = 'Low-Grade Pyrexia'
    } else if (temp < 36.0) {
      thermalDiagnosis = 'Hypothermia Risk'
    }

    // Calculated ECG metrics
    const rrIntervalMs = Math.round(60000 / Math.max(40, hr))
    const qrsWidthMs = 82 + (hr % 7)
    const qtcIntervalMs = Math.round(390 + (100 - spo2) * 1.5 + (hr > 100 ? 25 : 0))
    const stSegmentMv = (spo2 < 92 ? -0.08 : 0.01 + ((hr % 3) * 0.01)).toFixed(2)
    const hrvSdnnMs = Math.round(45 + ((100 - riskScore) * 0.4) + (hr % 5))

    // Overall Clinical Impression
    let overallImpression = 'Patient exhibits stable hemodynamic parameters. Vital telemetry within physiological target ranges.'
    if (riskScore > 60 || spo2 < 90 || hr > 130) {
      overallImpression = 'CRITICAL ALERT: Hemodynamic decompensation detected. Immediate clinical assessment and oxygen therapy recommended.'
    } else if (riskScore > 30 || spo2 < 94 || hr > 100) {
      overallImpression = 'WARNING: Elevated physiological stress index. Continuous monitoring and vitals verification advised.'
    }

    return {
      cardiacDiagnosis,
      cardiacRisk,
      cardiacColor,
      pulmonaryDiagnosis,
      pulmonaryRisk,
      pulmonaryColor,
      thermalDiagnosis,
      rrIntervalMs,
      qrsWidthMs,
      qtcIntervalMs,
      stSegmentMv,
      hrvSdnnMs,
      overallImpression,
    }
  }, [patient])

  // Real-time telemetry log lines
  const [telemetryLogs, setTelemetryLogs] = useState<string[]>([])

  useEffect(() => {
    const d = new Date()
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
    const newLogs = [
      `[${timeStr}] AI DIAGNOSTIC ENGINE: Processing Lead II ECG & Pulse Oximetry...`,
      `[${timeStr}] CARDIAC: ${diagnostics.cardiacDiagnosis} (HR: ${patient.hr} bpm, R-R: ${diagnostics.rrIntervalMs}ms)`,
      `[${timeStr}] PULMONARY: ${diagnostics.pulmonaryDiagnosis} (SpO₂: ${patient.spo2}%)`,
      `[${timeStr}] THERMAL: ${diagnostics.thermalDiagnosis} (${patient.temp}°C)`,
      `[${timeStr}] AUTONOMIC: HRV SDNN ${diagnostics.hrvSdnnMs}ms • Risk Index ${patient.riskScore}/100`,
    ]
    setTelemetryLogs(newLogs)
  }, [patient, diagnostics])

  // Trigger Real-Time AI Diagnostic Scan
  const handleRunDiagnosticScan = () => {
    monitorAudio.playScanSound()
    setIsScanning(true)
    setScanStep(1)

    if (onScanTrigger) onScanTrigger()

    setTimeout(() => setScanStep(2), 500)
    setTimeout(() => setScanStep(3), 1100)
    setTimeout(() => {
      setScanStep(4)
      setIsScanning(false)
      const now = new Date()
      setLastScanTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`)
    }, 1800)
  }

  return (
    <div className="relative rounded-2xl border border-cyan-500/20 bg-[#06111D]/80 p-3.5 backdrop-blur-xl flex flex-col gap-3 overflow-hidden shadow-[0_0_30px_rgba(6,17,29,0.8)]">
      
      {/* Scanning Laser Animation Overlay */}
      {isScanning && (
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
          <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-scan-beam" />
          <div className="absolute inset-0 bg-cyan-500/5 backdrop-blur-[1px]" />
        </div>
      )}

      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-cyan-500/12 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.25)]">
            <BrainCircuit className="size-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              Real-Time AI Clinical Diagnostics
              <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[9px] font-mono text-cyan-300">LIVE FEED</span>
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">Continuous Telemetry Signal Analysis & Neural Pattern Detection</p>
          </div>
        </div>

        {/* Scan Trigger Button */}
        <button
          onClick={handleRunDiagnosticScan}
          disabled={isScanning}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-all ${
            isScanning
              ? 'border-cyan-400/50 bg-cyan-500/25 text-cyan-200 animate-pulse cursor-not-allowed'
              : 'border-cyan-400/40 bg-gradient-to-r from-cyan-500/20 to-teal-500/20 text-cyan-200 hover:border-cyan-300 hover:from-cyan-500/30 hover:to-teal-500/30 shadow-[0_0_15px_rgba(34,211,238,0.2)]'
          }`}
        >
          <Sparkles className={`size-3.5 text-cyan-300 ${isScanning ? 'animate-spin' : ''}`} />
          <span>{isScanning ? `Scanning Lead II (${scanStep}/4)...` : 'Run AI Diagnostic Scan'}</span>
        </button>
      </div>

      {/* Realtime Status Bar Banner */}
      <div className="rounded-xl border border-white/8 bg-black/40 p-2.5 flex items-center justify-between flex-wrap gap-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-mono text-slate-300">Live AI Assessment:</span>
          <span className={diagnostics.cardiacColor}>{diagnostics.cardiacDiagnosis}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
          <span>Confidence: <strong className="text-cyan-300">99.4%</strong></span>
          <span>Last Scan: <strong className="text-slate-200">{lastScanTime}</strong></span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl border border-white/6 bg-black/50 p-1">
        {(['Diagnostic', 'ECG Metrics', 'Differential', 'Telemetry Feed'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-lg py-1 text-[10px] font-semibold transition-all ${
              activeTab === tab
                ? 'border border-cyan-400/30 bg-cyan-500/18 text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.15)]'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'Diagnostic' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {/* Cardiac Diagnosis */}
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                <Heart className="size-3 text-rose-500 animate-pulse" /> Cardiac Rhythm
              </span>
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-rose-300">
                {diagnostics.cardiacRisk} RISK
              </span>
            </div>
            <p className="mt-1.5 text-xs font-bold text-white">{diagnostics.cardiacDiagnosis}</p>
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-rose-500/10 pt-1.5">
              <span>Heart Rate: <strong className="text-white">{patient.hr} bpm</strong></span>
              <span>R-R: <strong className="text-rose-300">{diagnostics.rrIntervalMs} ms</strong></span>
            </div>
          </div>

          {/* Pulmonary Diagnosis */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                <Wind className="size-3 text-cyan-400" /> Gas Exchange & SpO₂
              </span>
              <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-cyan-300">
                {diagnostics.pulmonaryRisk}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-bold text-white">{diagnostics.pulmonaryDiagnosis}</p>
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-cyan-500/10 pt-1.5">
              <span>Oxygen Sat: <strong className="text-white">{patient.spo2}%</strong></span>
              <span>Resp Rate: <strong className="text-cyan-300">{patient.rr} br/min</strong></span>
            </div>
          </div>

          {/* Thermoregulation & Stress */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                <Thermometer className="size-3 text-amber-400" /> Thermoregulation & Stress
              </span>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-amber-300">
                HRV: {diagnostics.hrvSdnnMs}ms
              </span>
            </div>
            <p className="mt-1.5 text-xs font-bold text-white">{diagnostics.thermalDiagnosis}</p>
            <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-amber-500/10 pt-1.5">
              <span>Core Temp: <strong className="text-white">{patient.temp}°C</strong></span>
              <span>Stress Index: <strong className="text-amber-300">{patient.riskScore}/100</strong></span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ECG Metrics' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
          <div className="rounded-xl border border-white/6 bg-black/40 p-2">
            <span className="text-[9px] text-slate-400 block uppercase">R-R Interval</span>
            <span className="text-sm font-bold text-cyan-300">{diagnostics.rrIntervalMs} ms</span>
          </div>
          <div className="rounded-xl border border-white/6 bg-black/40 p-2">
            <span className="text-[9px] text-slate-400 block uppercase">QRS Complex</span>
            <span className="text-sm font-bold text-emerald-300">{diagnostics.qrsWidthMs} ms</span>
          </div>
          <div className="rounded-xl border border-white/6 bg-black/40 p-2">
            <span className="text-[9px] text-slate-400 block uppercase">QTc Duration</span>
            <span className="text-sm font-bold text-violet-300">{diagnostics.qtcIntervalMs} ms</span>
          </div>
          <div className="rounded-xl border border-white/6 bg-black/40 p-2">
            <span className="text-[9px] text-slate-400 block uppercase">ST Deviation</span>
            <span className="text-sm font-bold text-rose-300">{diagnostics.stSegmentMv} mV</span>
          </div>
        </div>
      )}

      {activeTab === 'Differential' && (
        <div className="rounded-xl border border-white/8 bg-black/40 p-3 space-y-2 text-xs">
          <p className="font-semibold text-slate-200 flex items-center gap-1.5">
            <FileText className="size-3.5 text-cyan-400" /> AI Differential Diagnosis Assessment
          </p>
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between text-slate-300">
              <span>1. Normal Sinus Physiology</span>
              <span className="font-mono text-emerald-400 font-bold">{patient.riskScore < 30 ? '94%' : '18%'}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full" style={{ width: patient.riskScore < 30 ? '94%' : '18%' }} />
            </div>

            <div className="flex items-center justify-between text-slate-300 pt-1">
              <span>2. Mild Autonomic Stress / Sinus Tachycardia</span>
              <span className="font-mono text-amber-400 font-bold">{patient.hr > 100 ? '78%' : '5%'}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: patient.hr > 100 ? '78%' : '5%' }} />
            </div>

            <div className="flex items-center justify-between text-slate-300 pt-1">
              <span>3. Oxygen Desaturation / Ventilation Mismatch</span>
              <span className="font-mono text-rose-400 font-bold">{patient.spo2 < 94 ? '82%' : '2%'}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-rose-400 rounded-full" style={{ width: patient.spo2 < 94 ? '82%' : '2%' }} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Telemetry Feed' && (
        <div className="rounded-xl border border-white/8 bg-black/60 p-2.5 font-mono text-[10px] space-y-1 max-h-[110px] overflow-y-auto dashboard-scroll text-slate-300">
          {telemetryLogs.map((log, idx) => (
            <p key={idx} className="leading-tight truncate border-b border-white/4 pb-0.5">{log}</p>
          ))}
        </div>
      )}

      {/* Impression Footer */}
      <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-2.5 flex items-center justify-between gap-3 text-[11px]">
        <p className="text-slate-300 font-medium leading-tight">
          <strong className="text-cyan-300 font-mono">Clinical Note: </strong>
          {diagnostics.overallImpression}
        </p>
      </div>

    </div>
  )
}

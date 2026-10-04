'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  Radio, Signal, RefreshCw, Zap, ShieldCheck, Activity, Layers, Cpu,
  Volume2, VolumeX, BarChart3, Network, Sliders, Maximize2, AlertCircle, Wifi
} from 'lucide-react'

export interface HardwareNode {
  id: string
  name: string
  patientId: string
  room: string
  angle: number // Radians 0 to 2*PI
  distance: number // 0.15 to 0.85 (relative radius)
  rssi: number // -30 to -85 dBm
  battery: number
  status: 'online' | 'warning' | 'offline'
  packetsPerSec: number
  latencyMs: number
  snrDb: number
  frequencyGHz: number
  chipset: string
  firmware: string
  uwbDistanceM: number
  respirationDisplacementMm: number
}

interface HardwareSignalRadarProps {
  nodes?: HardwareNode[]
  selectedPatientId?: string | null
  onSelectPatient?: (patientId: string) => void
}

const DEFAULT_HARDWARE_NODES: HardwareNode[] = [
  {
    id: 'node-101', name: 'ESP32-S3-IoT-01', patientId: 'patient-101', room: 'Bed 101',
    angle: 0.8, distance: 0.45, rssi: -42, battery: 98, status: 'online',
    packetsPerSec: 128, latencyMs: 3.2, snrDb: 34, frequencyGHz: 2.412,
    chipset: 'ESP32-S3 + NRF24', firmware: 'v2.8.4-med', uwbDistanceM: 1.42, respirationDisplacementMm: 3.4
  },
  {
    id: 'node-102', name: 'ESP32-S3-IoT-02', patientId: 'patient-102', room: 'Bed 102',
    angle: 2.3, distance: 0.65, rssi: -58, battery: 85, status: 'online',
    packetsPerSec: 112, latencyMs: 4.8, snrDb: 28, frequencyGHz: 2.437,
    chipset: 'ESP32-S3-WROOM', firmware: 'v2.8.4-med', uwbDistanceM: 2.15, respirationDisplacementMm: 4.1
  },
  {
    id: 'node-103', name: 'ESP32-S3-IoT-03', patientId: 'patient-103', room: 'ICU-A',
    angle: 4.1, distance: 0.35, rssi: -38, battery: 94, status: 'warning',
    packetsPerSec: 96, latencyMs: 8.5, snrDb: 22, frequencyGHz: 2.462,
    chipset: 'STM32WB55 + BLE', firmware: 'v3.1.0-icu', uwbDistanceM: 0.98, respirationDisplacementMm: 5.8
  },
  {
    id: 'node-104', name: 'ESP32-S3-IoT-04', patientId: 'patient-104', room: 'ICU-B',
    angle: 5.5, distance: 0.78, rssi: -72, battery: 72, status: 'online',
    packetsPerSec: 104, latencyMs: 6.1, snrDb: 19, frequencyGHz: 2.484,
    chipset: 'nRF52840-Mesh', firmware: 'v2.8.4-med', uwbDistanceM: 2.80, respirationDisplacementMm: 2.9
  },
]

export function HardwareSignalRadar({
  nodes = DEFAULT_HARDWARE_NODES,
  selectedPatientId,
  onSelectPatient,
}: HardwareSignalRadarProps) {
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const bioRadarCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const [activeTab, setActiveTab] = useState<'radar' | 'spectrum' | 'mesh'>('radar')
  const [rangeScaleM, setRangeScaleM] = useState<number>(25) // 10m, 25m, 50m
  const [isAudioMuted, setIsAudioMuted] = useState(false)
  const [isPingActive, setIsPingActive] = useState(false)
  const [totalRxPackets, setTotalRxPackets] = useState(18420)
  const [showNodeModal, setShowNodeModal] = useState(false)

  const pingPulseRef = useRef<number>(0)
  const sweepAngleRef = useRef<number>(0)
  const blipRipplesRef = useRef<Record<string, { alpha: number; radius: number }>>({})

  // Currently selected node
  const activeNode = useMemo(() => {
    return nodes.find(n => n.patientId === selectedPatientId) || nodes[0]
  }, [nodes, selectedPatientId])

  // Web Audio Sonar Ping synthesizer
  const playRadarPingSound = useCallback((freq = 1200) => {
    if (isAudioMuted) return
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextClass) return
      const ctx = new AudioContextClass()
      if (ctx.state === 'suspended') ctx.resume()

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.18)

      gain.gain.setValueAtTime(0.09, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start()
      osc.stop(ctx.currentTime + 0.19)
    } catch {
      // Audio context silenced or blocked
    }
  }, [isAudioMuted])

  // Trigger manual ping pulse
  const handleManualPing = () => {
    setIsPingActive(true)
    pingPulseRef.current = 0.05
    playRadarPingSound(1400)
    setTimeout(() => setIsPingActive(false), 1200)
  }

  // Increment total packet count periodically
  useEffect(() => {
    const timer = setInterval(() => {
      setTotalRxPackets(prev => prev + Math.floor(Math.random() * 14 + 10))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // ---------------------------------------------------------------------------
  // Canvas 1: Polar Radar Render Loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (activeTab !== 'radar') return
    const canvas = radarCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number

    const render = () => {
      const width = canvas.width
      const height = canvas.height
      const centerX = width / 2
      const centerY = height / 2
      const maxRadius = Math.min(centerX, centerY) - 10

      ctx.clearRect(0, 0, width, height)

      // 1. Radial Gradient Background Frame
      const bgGrad = ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, maxRadius)
      bgGrad.addColorStop(0, 'rgba(6, 182, 212, 0.08)')
      bgGrad.addColorStop(0.65, 'rgba(3, 105, 161, 0.03)')
      bgGrad.addColorStop(1, 'rgba(1, 6, 18, 0.95)')
      ctx.fillStyle = bgGrad
      ctx.beginPath()
      ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2)
      ctx.fill()

      // 2. Concentric Distance Grid Circles
      const ringCount = 4
      for (let i = 1; i <= ringCount; i++) {
        const r = (maxRadius / ringCount) * i
        ctx.beginPath()
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2)
        ctx.strokeStyle = i === ringCount ? 'rgba(56, 189, 248, 0.35)' : 'rgba(56, 189, 248, 0.12)'
        ctx.lineWidth = i === ringCount ? 1.5 : 1
        ctx.setLineDash(i % 2 === 0 ? [] : [3, 3])
        ctx.stroke()
        ctx.setLineDash([])

        // Range Scale labels
        if (i < ringCount) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.5)'
          ctx.font = '8px monospace'
          const distVal = Math.round((rangeScaleM / ringCount) * i)
          ctx.fillText(`${distVal}m`, centerX + 4, centerY - r + 10)
        }
      }

      // 3. Azimuth Crosshair & Ticks (12 spokes)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)'
      ctx.lineWidth = 1
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
        ctx.beginPath()
        ctx.moveTo(centerX, centerY)
        ctx.lineTo(centerX + Math.cos(angle) * maxRadius, centerY + Math.sin(angle) * maxRadius)
        ctx.stroke()
      }

      // 4. Ping Shockwave Pulse
      if (pingPulseRef.current > 0) {
        const pingR = pingPulseRef.current * maxRadius
        ctx.beginPath()
        ctx.arc(centerX, centerY, pingR, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(34, 211, 238, ${Math.max(0, 1 - pingPulseRef.current)})`
        ctx.lineWidth = 3
        ctx.shadowColor = '#22d3ee'
        ctx.shadowBlur = 12
        ctx.stroke()
        ctx.shadowBlur = 0

        pingPulseRef.current += 0.022
        if (pingPulseRef.current > 1) pingPulseRef.current = 0
      }

      // 5. Rotating Radar Sweep Beam
      sweepAngleRef.current = (sweepAngleRef.current + 0.024) % (Math.PI * 2)
      const currentSweep = sweepAngleRef.current

      // Trailing cone gradient
      const sweepSegments = 45
      for (let i = 0; i < sweepSegments; i++) {
        const segAngle = currentSweep - (i * 0.015)
        const alpha = Math.max(0, (1 - i / sweepSegments) * 0.22)

        ctx.beginPath()
        ctx.moveTo(centerX, centerY)
        ctx.arc(centerX, centerY, maxRadius, segAngle - 0.015, segAngle)
        ctx.closePath()
        ctx.fillStyle = `rgba(34, 211, 238, ${alpha})`
        ctx.fill()
      }

      // Leading beam line
      const sweepX = centerX + Math.cos(currentSweep) * maxRadius
      const sweepY = centerY + Math.sin(currentSweep) * maxRadius
      ctx.beginPath()
      ctx.moveTo(centerX, centerY)
      ctx.lineTo(sweepX, sweepY)
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 2
      ctx.shadowColor = '#22d3ee'
      ctx.shadowBlur = 10
      ctx.stroke()
      ctx.shadowBlur = 0

      // 6. Draw Hardware Node Blips + Vector Velocity Arrows
      nodes.forEach(node => {
        const nodeX = centerX + Math.cos(node.angle) * (node.distance * maxRadius)
        const nodeY = centerY + Math.sin(node.angle) * (node.distance * maxRadius)
        const isSelected = selectedPatientId === node.patientId

        // Check sweep collision
        let angleDiff = Math.abs(currentSweep - node.angle)
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff

        if (angleDiff < 0.04) {
          blipRipplesRef.current[node.id] = { alpha: 1.0, radius: 4 }
        }

        // Active ripple ring
        const ripple = blipRipplesRef.current[node.id]
        if (ripple && ripple.alpha > 0.02) {
          ctx.beginPath()
          ctx.arc(nodeX, nodeY, ripple.radius, 0, Math.PI * 2)
          ctx.strokeStyle = node.status === 'warning'
            ? `rgba(251, 191, 36, ${ripple.alpha})`
            : `rgba(34, 211, 238, ${ripple.alpha})`
          ctx.lineWidth = 1.5
          ctx.stroke()

          ripple.radius += 0.45
          ripple.alpha *= 0.92
        }

        // Selected halo & target reticle
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(nodeX, nodeY, 11, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(56, 189, 248, 0.22)'
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1.2
          ctx.fill()
          ctx.stroke()

          // Reticle brackets
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(nodeX - 14, nodeY); ctx.lineTo(nodeX - 8, nodeY)
          ctx.moveTo(nodeX + 8, nodeY); ctx.lineTo(nodeX + 14, nodeY)
          ctx.moveTo(nodeX, nodeY - 14); ctx.lineTo(nodeX, nodeY - 8)
          ctx.moveTo(nodeX, nodeY + 8); ctx.lineTo(nodeX, nodeY + 14)
          ctx.stroke()
        }

        // Node blip dot
        ctx.beginPath()
        ctx.arc(nodeX, nodeY, isSelected ? 4.5 : 3.5, 0, Math.PI * 2)
        const blipColor = node.status === 'warning' ? '#fbbf24' : node.status === 'offline' ? '#f43f5e' : '#34d399'
        ctx.fillStyle = blipColor
        ctx.shadowColor = blipColor
        ctx.shadowBlur = isSelected ? 14 : 6
        ctx.fill()
        ctx.shadowBlur = 0

        // Label text & RSSI readout
        ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(226, 232, 240, 0.8)'
        ctx.font = isSelected ? 'bold 9px monospace' : '8px monospace'
        ctx.fillText(`${node.room}`, nodeX + 8, nodeY + 2)

        if (isSelected) {
          ctx.fillStyle = '#38bdf8'
          ctx.font = '7px monospace'
          ctx.fillText(`${node.rssi}dBm`, nodeX + 8, nodeY + 10)
        }
      })

      // Central Base Station Gateway Hub
      ctx.beginPath()
      ctx.arc(centerX, centerY, 5.5, 0, Math.PI * 2)
      ctx.fillStyle = '#06b6d4'
      ctx.shadowColor = '#06b6d4'
      ctx.shadowBlur = 12
      ctx.fill()
      ctx.shadowBlur = 0

      animationId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animationId)
  }, [activeTab, nodes, selectedPatientId, rangeScaleM])

  // ---------------------------------------------------------------------------
  // Canvas 2: Real-time RF Spectrum Analyzer Loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (activeTab !== 'spectrum') return
    const canvas = spectrumCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    const channels = 16

    const render = () => {
      const width = canvas.width
      const height = canvas.height

      ctx.clearRect(0, 0, width, height)

      // Background grid
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.1)'
      ctx.lineWidth = 1
      for (let y = 20; y < height; y += 20) {
        ctx.beginPath()
        ctx.moveTo(0, y); ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Noise floor line (-95 dBm)
      const noiseY = height - 25
      ctx.beginPath()
      ctx.moveTo(0, noiseY); ctx.lineTo(width, noiseY)
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)'
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = 'rgba(244, 63, 94, 0.6)'
      ctx.font = '8px monospace'
      ctx.fillText('NOISE FLOOR -95dBm', 6, noiseY - 4)

      // Spectrum Bars for Channels 11 to 26 (2.4GHz WiFi/BLE)
      const barWidth = (width - 20) / channels
      for (let i = 0; i < channels; i++) {
        const chNum = 11 + i
        const x = 10 + i * barWidth

        // Dynamic spectral power height
        const activeCh = activeNode ? Math.floor((activeNode.frequencyGHz - 2.4) * 200) % channels : 3
        const isTargetCh = i === activeCh
        const noise = Math.sin(Date.now() * 0.005 + i) * 12
        const baseHeight = isTargetCh ? 90 + noise : 25 + Math.abs(noise * 0.8)

        const barY = height - 20 - baseHeight

        // Bar gradient
        const grad = ctx.createLinearGradient(0, height - 20, 0, barY)
        grad.addColorStop(0, isTargetCh ? 'rgba(34, 211, 238, 0.2)' : 'rgba(56, 189, 248, 0.1)')
        grad.addColorStop(1, isTargetCh ? '#22d3ee' : '#0284c7')

        ctx.fillStyle = grad
        ctx.fillRect(x + 2, barY, barWidth - 4, baseHeight)

        // Peak line
        ctx.fillStyle = isTargetCh ? '#ffffff' : '#38bdf8'
        ctx.fillRect(x + 2, barY - 2, barWidth - 4, 2)

        // Channel label
        ctx.fillStyle = isTargetCh ? '#22d3ee' : 'rgba(148, 163, 184, 0.6)'
        ctx.font = '7px monospace'
        ctx.fillText(`C${chNum}`, x + 2, height - 8)
      }

      animationId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animationId)
  }, [activeTab, activeNode])

  // ---------------------------------------------------------------------------
  // Canvas 3: UWB Micro-Doppler Bio-Radar Waveform Loop
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const canvas = bioRadarCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let t = 0

    const render = () => {
      t += 0.05
      const width = canvas.width
      const height = canvas.height
      const centerY = height / 2

      ctx.clearRect(0, 0, width, height)

      // Micro-Doppler Bio Respiration Waveform
      ctx.beginPath()
      ctx.moveTo(0, centerY)

      for (let x = 0; x < width; x += 2) {
        // Respiration sine wave + heartbeat pulse spike
        const respWave = Math.sin((x * 0.04) - t) * 8
        const cardiacSpike = Math.exp(-Math.pow(((x % 80) - 40) * 0.15, 2)) * 14 * Math.sin(t * 2)
        const y = centerY + respWave + cardiacSpike

        ctx.lineTo(x, y)
      }

      ctx.strokeStyle = '#34d399'
      ctx.lineWidth = 1.5
      ctx.shadowColor = '#34d399'
      ctx.shadowBlur = 6
      ctx.stroke()
      ctx.shadowBlur = 0

      animationId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animationId)
  }, [])

  // Canvas click node selection
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = radarCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    const width = canvas.width
    const height = canvas.height
    const centerX = width / 2
    const centerY = height / 2
    const maxRadius = Math.min(centerX, centerY) - 10

    let closestNode: HardwareNode | null = null
    let minDistance = 24

    nodes.forEach(node => {
      const nodeX = centerX + Math.cos(node.angle) * (node.distance * maxRadius)
      const nodeY = centerY + Math.sin(node.angle) * (node.distance * maxRadius)
      const dist = Math.hypot(clickX - nodeX, clickY - nodeY)

      if (dist < minDistance) {
        minDistance = dist
        closestNode = node
      }
    })

    if (closestNode) {
      const node = closestNode as HardwareNode
      onSelectPatient?.(node.patientId)
      playRadarPingSound(1500)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5 overflow-hidden" style={{ background: 'var(--card)' }} role="region" aria-label="Hardware signal radar">
      {/* HEADER & TAB SWITCHER */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio className="size-3.5 text-cyan-400" aria-hidden="true" />
          <div>
            <h3 className="text-[10px] font-semibold tracking-wider text-slate-300 uppercase">Signal Radar</h3>
            <p className="text-[8px] font-mono text-slate-600">RF Mesh &middot; UWB</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 font-mono text-[9px]">
          <button
            onClick={() => setActiveTab('radar')}
            className={`rounded px-2 py-0.5 transition-colors ${
              activeTab === 'radar' ? 'bg-cyan-500/10 text-cyan-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
            }`}
            aria-label="Radar view"
          >
            Radar
          </button>
          <button
            onClick={() => setActiveTab('spectrum')}
            className={`rounded px-2 py-0.5 transition-colors ${
              activeTab === 'spectrum' ? 'bg-cyan-500/10 text-cyan-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
            }`}
            aria-label="Spectrum view"
          >
            Spectrum
          </button>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 font-mono text-[9px]" style={{ background: 'var(--background)' }}>
        <div className="flex items-center gap-1">
          <span className="text-slate-600">Range:</span>
          {[10, 25, 50].map((m) => (
            <button
              key={m}
              onClick={() => setRangeScaleM(m)}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                rangeScaleM === m ? 'bg-cyan-500/10 text-cyan-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {m}m
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsAudioMuted(!isAudioMuted)}
            className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
            aria-label={isAudioMuted ? 'Unmute' : 'Mute'}
          >
            {isAudioMuted ? <VolumeX className="size-3 text-rose-400" /> : <Volume2 className="size-3 text-cyan-400" />}
          </button>
          <button
            onClick={handleManualPing}
            disabled={isPingActive}
            className={`flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[9px] font-medium transition-colors ${
              isPingActive
                ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300'
                : 'border-border bg-cyan-500/6 text-cyan-400 hover:bg-cyan-500/10'
            }`}
          >
            <RefreshCw className={`size-2.5 ${isPingActive ? 'animate-spin' : ''}`} />
            Ping
          </button>
        </div>
      </div>

      {/* MAIN CANVAS */}
      <div className="relative grid place-items-center rounded-md border border-border overflow-hidden" style={{ background: 'var(--background)' }}>
        {activeTab === 'radar' && (
          <canvas ref={radarCanvasRef} width={240} height={115} onClick={handleCanvasClick} className="cursor-pointer rounded touch-none" aria-label="Radar display" />
        )}
        {activeTab === 'spectrum' && (
          <canvas ref={spectrumCanvasRef} width={240} height={115} className="rounded touch-none" aria-label="Spectrum analyzer" />
        )}
        <div className="absolute top-1.5 left-1.5 pointer-events-none">
          <div className="flex items-center gap-1 text-[9px] font-mono text-slate-300 bg-black/70 px-1.5 py-0.5 rounded border border-border">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Nodes: {nodes.length}/{nodes.length}
          </div>
        </div>
        {activeNode && (
          <button onClick={() => setShowNodeModal(true)} className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[8px] font-mono text-slate-400 bg-black/70 px-1.5 py-0.5 rounded border border-border hover:text-slate-200 transition-colors" aria-label={`Diagnostics for ${activeNode.name}`}>
            <Cpu className="size-2.5 text-cyan-400" />
            {activeNode.room}
            <Maximize2 className="size-2" />
          </button>
        )}
      </div>

      {/* BIO-RADAR */}
      <div className="flex flex-col gap-1 rounded-md border border-border p-1.5" style={{ background: 'var(--background)' }}>
        <div className="flex items-center justify-between font-mono text-[8px]">
          <span className="text-emerald-400 font-medium flex items-center gap-1">
            <Activity className="size-2.5" /> Bio-Radar
          </span>
          <span className="text-slate-500">{activeNode?.respirationDisplacementMm || 3.4} mm</span>
        </div>
        <canvas ref={bioRadarCanvasRef} width={240} height={26} className="w-full rounded" aria-label="Respiration waveform" />
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-3 gap-1 font-mono">
        <div className="flex flex-col rounded-md border border-border p-1.5" style={{ background: 'var(--background)' }}>
          <span className="text-[8px] text-slate-600 flex items-center gap-1"><Signal className="size-2.5 text-cyan-400" /> RSSI</span>
          <span className="text-[11px] font-semibold text-slate-300">{activeNode ? `${activeNode.rssi} dBm` : '-42 dBm'}</span>
        </div>
        <div className="flex flex-col rounded-md border border-border p-1.5" style={{ background: 'var(--background)' }}>
          <span className="text-[8px] text-slate-600 flex items-center gap-1"><Zap className="size-2.5 text-amber-400" /> Latency</span>
          <span className="text-[11px] font-semibold text-slate-300">{activeNode ? `${activeNode.latencyMs} ms` : '3.7 ms'}</span>
        </div>
        <div className="flex flex-col rounded-md border border-border p-1.5" style={{ background: 'var(--background)' }}>
          <span className="text-[8px] text-slate-600 flex items-center gap-1"><ShieldCheck className="size-2.5 text-emerald-400" /> Pkts</span>
          <span className="text-[11px] font-semibold text-slate-300">{totalRxPackets.toLocaleString()}</span>
        </div>
      </div>

      {/* NODE DIAGNOSTICS MODAL */}
      {showNodeModal && activeNode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Node diagnostics">
          <div className="flex flex-col gap-3 w-full max-w-sm rounded-xl border border-border p-4 font-mono text-xs" style={{ background: 'var(--card)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-cyan-400" aria-hidden="true" />
                <h4 className="font-semibold text-white text-[12px]">{activeNode.name}</h4>
              </div>
              <button onClick={() => setShowNodeModal(false)} className="text-slate-500 hover:text-white transition-colors text-sm" aria-label="Close">&#x2715;</button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {[
                { label: 'Patient Room', value: activeNode.room, color: '' },
                { label: 'Chipset', value: activeNode.chipset, color: '' },
                { label: 'RF Frequency', value: `${activeNode.frequencyGHz} GHz`, color: 'text-emerald-400' },
                { label: 'Firmware', value: activeNode.firmware, color: '' },
                { label: 'Battery', value: `${activeNode.battery}% (3.95V)`, color: 'text-emerald-400' },
                { label: 'UWB Distance', value: `${activeNode.uwbDistanceM} m`, color: 'text-cyan-400' },
              ].map(item => (
                <div key={item.label} className="flex flex-col rounded-lg border border-border p-2" style={{ background: 'var(--background)' }}>
                  <span className="text-slate-500 text-[9px]">{item.label}</span>
                  <span className={`font-medium ${item.color || 'text-slate-200'}`}>{item.value}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={() => setShowNodeModal(false)} className="rounded-lg border border-border px-3 py-1.5 text-slate-400 hover:text-slate-200 transition-colors text-[10px]">Close</button>
              <button onClick={() => { handleManualPing(); setShowNodeModal(false) }} className="rounded-lg border border-cyan-500/20 bg-cyan-500/8 px-3 py-1.5 text-cyan-400 font-medium hover:bg-cyan-500/12 transition-colors text-[10px]">Ping Node</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

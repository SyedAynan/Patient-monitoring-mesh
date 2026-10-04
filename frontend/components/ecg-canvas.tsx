'use client'

import { useEffect, useRef } from 'react'
import { monitorAudio } from '@/lib/audio'

export function ECGWaveformCanvas({
  height = 48,
  color = '#22c55e',
  hr = 72,
  spo2 = 98,
  temp = 36.8,
  status = 'normal',
  riskScore = 15,
  enableBeep = false,
}: {
  height?: number
  color?: string
  hr?: number
  spo2?: number
  temp?: number
  status?: string
  riskScore?: number
  enableBeep?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastPeakRef = useRef<number>(0)
  
  // Keep props up-to-date in ref to prevent restarting animation loop & resetting offset on telemetry updates
  const propsRef = useRef({ height, color, hr, spo2, temp, status, riskScore, enableBeep })
  useEffect(() => {
    propsRef.current = { height, color, hr, spo2, temp, status, riskScore, enableBeep }
  }, [height, color, hr, spo2, temp, status, riskScore, enableBeep])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let width = (canvas.width = canvas.parentElement?.clientWidth || 300)
    canvas.height = height

    let offset = 0

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = canvas.parentElement?.clientWidth || 300
      canvas.height = height
    }

    window.addEventListener('resize', handleResize)

    function getEcgY(x: number, h: number): number {
      const { hr: currentHr, spo2: currentSpo2, temp: currentTemp, status: currentStatus, riskScore: currentRisk, enableBeep: isBeepEnabled } = propsRef.current
      const mid = h / 2
      const period = 140
      const pos = (x + offset) % period

      // QRS Peak Detection for SpO2 Pitched Heartbeat Audio
      if (isBeepEnabled && pos >= 48 && pos <= 52) {
        const now = Date.now()
        // Minimum interval based on patient heart rate (60000 / hr * 0.7)
        const minInterval = (60000 / Math.max(40, currentHr)) * 0.7
        if (now - lastPeakRef.current > minInterval) {
          lastPeakRef.current = now
          monitorAudio.playHeartbeatBeep({ hr: currentHr, spo2: currentSpo2, temp: currentTemp, status: currentStatus, riskScore: currentRisk })
        }
      }

      if (pos > 30 && pos < 40) {
        // P wave
        return mid - Math.sin(((pos - 30) / 10) * Math.PI) * (h * 0.12)
      } else if (pos > 45 && pos < 48) {
        // Q wave
        return mid + (h * 0.15)
      } else if (pos >= 48 && pos <= 54) {
        // R wave peak
        return mid - (h * 0.42)
      } else if (pos > 54 && pos <= 58) {
        // S wave dip
        return mid + (h * 0.22)
      } else if (pos > 65 && pos < 82) {
        // T wave
        return mid - Math.sin(((pos - 65) / 17) * Math.PI) * (h * 0.18)
      }
      return mid + Math.sin(x * 0.05 + offset * 0.02) * 0.8
    }

    function draw() {
      const { hr: currentHr, color: currentColor } = propsRef.current
      const clampedHr = Math.max(40, Math.min(180, currentHr))
      const speed = (clampedHr / 72) * 1.5
      offset += speed

      ctx!.clearRect(0, 0, width, height)

      ctx!.beginPath()
      ctx!.lineWidth = 2
      ctx!.strokeStyle = currentColor
      ctx!.shadowBlur = 6
      ctx!.shadowColor = currentColor

      for (let x = 0; x < width; x += 2) {
        const y = getEcgY(x, height)
        if (x === 0) {
          ctx!.moveTo(x, y)
        } else {
          ctx!.lineTo(x, y)
        }
      }
      ctx!.stroke()
      ctx!.shadowBlur = 0

      animId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', handleResize)
    }
  }, [height])

  return <canvas ref={canvasRef} className="w-full" style={{ height: `${height}px` }} />
}

'use client'

import { useEffect, useRef } from 'react'
import { monitorAudio } from '@/lib/audio'

export function ECGWaveformCanvas({
  height = 48,
  color = '#22c55e',
  hr = 72,
  enableBeep = false,
}: {
  height?: number
  color?: string
  hr?: number
  enableBeep?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastPeakRef = useRef<number>(0)

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
      const mid = h / 2
      const period = 120
      const pos = (x + offset) % period

      // QRS Peak Detection for Heartbeat Sound Playback
      if (enableBeep && pos >= 49 && pos <= 51) {
        const now = Date.now()
        if (now - lastPeakRef.current > 400) {
          lastPeakRef.current = now
          monitorAudio.playHeartbeatBeep(hr)
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
      return mid + (Math.random() - 0.5) * 1.5
    }

    function draw() {
      offset += 1.8
      ctx!.clearRect(0, 0, width, height)

      ctx!.beginPath()
      ctx!.lineWidth = 2
      ctx!.strokeStyle = color
      ctx!.shadowBlur = 8
      ctx!.shadowColor = color

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
  }, [height, color, hr, enableBeep])

  return <canvas ref={canvasRef} className="w-full" style={{ height: `${height}px` }} />
}

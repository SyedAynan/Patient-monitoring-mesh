'use client'

import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  z: number
  radius: number
  alpha: number
  baseAlpha: number
  twinkleSpeed: number
  twinklePhase: number
  color: string
}

interface ShootingStar {
  x: number
  y: number
  length: number
  speed: number
  angle: number
  opacity: number
  active: boolean
}

const STAR_COLORS = ['#ffffff', '#e0f2fe', '#bae6fd', '#38bdf8', '#c084fc', '#fef08a']

export function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    let mouseX = width / 2
    let mouseY = height / 2
    let targetMouseX = mouseX
    let targetMouseY = mouseY

    const handleMouseMove = (e: MouseEvent) => {
      targetMouseX = e.clientX
      targetMouseY = e.clientY
    }

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
      initStars()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('resize', handleResize)

    let stars: Star[] = []
    const STAR_COUNT = 340

    function initStars() {
      stars = []
      for (let i = 0; i < STAR_COUNT; i++) {
        const z = Math.random() * 3 + 0.5
        const baseAlpha = 0.2 + Math.random() * 0.75
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          z,
          radius: (Math.random() * 1.6 + 0.4) / z,
          alpha: baseAlpha,
          baseAlpha,
          twinkleSpeed: 0.01 + Math.random() * 0.035,
          twinklePhase: Math.random() * Math.PI * 2,
          color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        })
      }
    }

    initStars()

    let shootingStar: ShootingStar = {
      x: 0,
      y: 0,
      length: 0,
      speed: 0,
      angle: 0,
      opacity: 0,
      active: false,
    }

    function spawnShootingStar() {
      if (Math.random() < 0.008 && !shootingStar.active) {
        shootingStar = {
          x: Math.random() * width * 0.8,
          y: Math.random() * height * 0.4,
          length: Math.random() * 90 + 70,
          speed: Math.random() * 12 + 14,
          angle: Math.PI / 4 + (Math.random() - 0.5) * 0.2,
          opacity: 1,
          active: true,
        }
      }
    }

    function render() {
      mouseX += (targetMouseX - mouseX) * 0.035
      mouseY += (targetMouseY - mouseY) * 0.035
      const offsetX = (mouseX - width / 2) * 0.018
      const offsetY = (mouseY - height / 2) * 0.018

      // Pitch black deep space background
      ctx!.fillStyle = '#010204'
      ctx!.fillRect(0, 0, width, height)

      // Cosmic Nebulae background glow
      const neb1 = ctx!.createRadialGradient(
        width * 0.25 + offsetX * 2,
        height * 0.2 + offsetY * 2,
        0,
        width * 0.25,
        height * 0.2,
        width * 0.55
      )
      neb1.addColorStop(0, 'rgba(56, 189, 248, 0.065)')
      neb1.addColorStop(0.5, 'rgba(139, 92, 246, 0.035)')
      neb1.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx!.fillStyle = neb1
      ctx!.fillRect(0, 0, width, height)

      const neb2 = ctx!.createRadialGradient(
        width * 0.8 - offsetX * 3,
        height * 0.75 - offsetY * 3,
        0,
        width * 0.8,
        height * 0.75,
        width * 0.5
      )
      neb2.addColorStop(0, 'rgba(168, 85, 247, 0.055)')
      neb2.addColorStop(0.6, 'rgba(16, 185, 129, 0.025)')
      neb2.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx!.fillStyle = neb2
      ctx!.fillRect(0, 0, width, height)

      // Draw Twinkling Stars
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i]
        star.twinklePhase += star.twinkleSpeed
        const twinkle = Math.sin(star.twinklePhase) * 0.4
        star.alpha = Math.max(0.1, Math.min(1, star.baseAlpha + twinkle))

        const sx = star.x + offsetX * (1 / star.z)
        const sy = star.y + offsetY * (1 / star.z)

        const wrappedX = (sx + width) % width
        const wrappedY = (sy + height) % height

        ctx!.beginPath()
        ctx!.arc(wrappedX, wrappedY, star.radius, 0, Math.PI * 2)
        ctx!.fillStyle = star.color
        ctx!.globalAlpha = star.alpha
        if (star.radius > 1.2) {
          ctx!.shadowBlur = 8
          ctx!.shadowColor = star.color
        }
        ctx!.fill()
        ctx!.shadowBlur = 0
      }

      ctx!.globalAlpha = 1

      // Render Shooting Star
      spawnShootingStar()
      if (shootingStar.active) {
        shootingStar.x += Math.cos(shootingStar.angle) * shootingStar.speed
        shootingStar.y += Math.sin(shootingStar.angle) * shootingStar.speed
        shootingStar.opacity -= 0.012

        if (
          shootingStar.opacity <= 0 ||
          shootingStar.x > width ||
          shootingStar.y > height
        ) {
          shootingStar.active = false
        } else {
          const tailX =
            shootingStar.x - Math.cos(shootingStar.angle) * shootingStar.length
          const tailY =
            shootingStar.y - Math.sin(shootingStar.angle) * shootingStar.length

          const grad = ctx!.createLinearGradient(
            shootingStar.x,
            shootingStar.y,
            tailX,
            tailY
          )
          grad.addColorStop(0, `rgba(255, 255, 255, ${shootingStar.opacity})`)
          grad.addColorStop(0.35, `rgba(56, 189, 248, ${shootingStar.opacity * 0.8})`)
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)')

          ctx!.beginPath()
          ctx!.moveTo(shootingStar.x, shootingStar.y)
          ctx!.lineTo(tailX, tailY)
          ctx!.strokeStyle = grad
          ctx!.lineWidth = 2
          ctx!.stroke()
        }
      }

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0 h-full w-full bg-[#000000]"
      aria-hidden="true"
    />
  )
}

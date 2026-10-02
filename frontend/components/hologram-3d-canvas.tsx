'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

interface Hologram3DProps {
  hr?: number
}

// ---------------------------------------------------------------------------
// 1. 3D Human Holographic Digital Twin Mesh Component
// ---------------------------------------------------------------------------
function HolographicHumanModel({ hr = 74 }: { hr?: number }) {
  const { scene } = useGLTF('/human-model.glb')
  const groupRef = useRef<THREE.Group>(null)
  const heartPulseRef = useRef<THREE.Mesh>(null)

  // Compute model bounding box to dynamically scale and center the model
  const { clonedScene, wireframeScene, heartPosition, bounds } = useMemo(() => {
    const clone = scene.clone(true)
    const wireframe = scene.clone(true)

    // Compute bounding box
    const bbox = new THREE.Box3().setFromObject(clone)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    bbox.getSize(size)
    bbox.getCenter(center)

    // Center model at origin
    clone.position.set(-center.x, -center.y, -center.z)
    wireframe.position.set(-center.x, -center.y, -center.z)

    // Apply cyan-blue medical holographic materials (NOT pure white!)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.material = new THREE.MeshPhongMaterial({
          color: new THREE.Color('#0284c7'),
          emissive: new THREE.Color('#0369a1'),
          emissiveIntensity: 0.35,
          specular: new THREE.Color('#38bdf8'),
          shininess: 60,
          transparent: true,
          opacity: 0.58,
          side: THREE.DoubleSide,
        })
      }
    })

    // Delicate subtle wireframe overlay
    wireframe.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.material = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#38bdf8'),
          wireframe: true,
          transparent: true,
          opacity: 0.18,
        })
      }
    })

    // Anatomical Heart Position (Left Chest: ~25% from top of body, slightly left of center)
    const heartY = size.y * 0.28
    const heartX = -size.x * 0.08
    const heartZ = size.z * 0.15

    return {
      clonedScene: clone,
      wireframeScene: wireframe,
      heartPosition: [heartX, heartY, heartZ] as [number, number, number],
      bounds: { size, center },
    }
  }, [scene])

  // Desired height in 3D scene units
  const targetHeight = 2.2
  const scaleFactor = bounds.size.y > 0 ? targetHeight / bounds.size.y : 1

  // Animation Loop: Idle breathing & dynamic HR heart pulse
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()

    // Subtle idle floating motion
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(time * 1.2) * 0.015
    }

    // Dynamic Heart Pulse matching patient HR
    if (heartPulseRef.current) {
      const beatsPerSec = Math.max(40, hr) / 60
      const pulsePhase = (time * beatsPerSec * Math.PI * 2) % (Math.PI * 2)
      const scale = 1 + Math.pow(Math.sin(pulsePhase), 4) * 0.4
      heartPulseRef.current.scale.setScalar(scale)
    }
  })

  return (
    <group ref={groupRef} scale={[scaleFactor, scaleFactor, scaleFactor]} position={[0, 0, 0]}>
      {/* Base Holographic Mesh */}
      <primitive object={clonedScene} />

      {/* Delicate Wireframe Grid */}
      <primitive object={wireframeScene} />

      {/* Integrated Pulsing Anatomical Heart Marker (Left Chest) */}
      <group position={heartPosition}>
        <mesh ref={heartPulseRef}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color="#f43f5e" transparent opacity={0.65} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.035, 16, 16]} />
          <meshStandardMaterial color="#ffffff" emissive="#f43f5e" emissiveIntensity={2.5} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 2. Subtle Medical Holographic Platform & Scan Beam
// ---------------------------------------------------------------------------
function HolographicPlatform() {
  const outerRingRef = useRef<THREE.Mesh>(null)
  const scanLineRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()
    if (outerRingRef.current) outerRingRef.current.rotation.z = time * 0.15
    if (scanLineRef.current) {
      scanLineRef.current.position.y = Math.sin(time * 1.4) * 1.05
    }
  })

  // Particles rising from platform
  const particleCount = 35
  const particlePositions = useMemo(() => {
    const pos = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1.5
      pos[i * 3 + 1] = Math.random() * 2.2 - 1.1
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.5
    }
    return pos
  }, [particleCount])

  return (
    <group position={[0, -1.15, 0]}>
      {/* Outer Rotating Scanning Ring */}
      <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 0.78, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* Inner Concentric Disc Glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.78, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>

      {/* Vertical Animated Scanning Beam Sweep */}
      <mesh ref={scanLineRef} position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.01, 0.7, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* Subtle Rising Particles */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.02} color="#7dd3fc" transparent opacity={0.45} />
      </points>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 3. Loading Fallback State
// ---------------------------------------------------------------------------
function HologramLoadingState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center font-mono text-xs">
      <div className="relative mb-3 flex size-12 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full border border-cyan-400 opacity-75" />
        <div className="size-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      </div>
      <p className="font-semibold text-cyan-300 tracking-wider">INITIALIZING 3D DIGITAL TWIN...</p>
      <p className="mt-1 text-[10px] text-slate-500">Loading anatomical GLTF matrix</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Main Exported 3D Hologram Canvas Component
// ---------------------------------------------------------------------------
export function Hologram3DCanvas({ hr = 74 }: Hologram3DProps) {
  return (
    <div className="relative h-[290px] w-full overflow-hidden rounded-2xl bg-[#010512] border border-cyan-500/20 shadow-inner">
      <Suspense fallback={<HologramLoadingState />}>
        <Canvas
          camera={{ position: [0, 0, 3.2], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={['#010512']} />
          {/* Balanced Ambient & Directional Rim Lighting (No Overexposure!) */}
          <ambientLight intensity={0.4} color="#0c4a6e" />
          <directionalLight position={[2, 3, 4]} intensity={1.2} color="#38bdf8" />
          <directionalLight position={[-2, 1, -3]} intensity={1.5} color="#0284c7" />

          <HolographicPlatform />
          <HolographicHumanModel hr={hr} />

          <OrbitControls
            enablePan={false}
            enableZoom={false}
            minPolarAngle={Math.PI / 2.5}
            maxPolarAngle={Math.PI / 1.8}
            rotateSpeed={0.5}
          />
        </Canvas>
      </Suspense>
    </div>
  )
}

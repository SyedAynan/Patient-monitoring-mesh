'use client'

import { Suspense, useMemo, useRef } from 'react'
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
  const modelRef = useRef<THREE.Group>(null)
  const heartPulseRef = useRef<THREE.Mesh>(null)

  // Clone scene to avoid mutating cached GLTF
  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)
    
    // Apply dual-layer cyan holographic materials to all meshes
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        
        // Primary transparent emissive holographic material
        mesh.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#0284c7'),
          emissive: new THREE.Color('#38bdf8'),
          emissiveIntensity: 1.8,
          transparent: true,
          opacity: 0.55,
          roughness: 0.1,
          metalness: 0.2,
          side: THREE.DoubleSide,
        })
      }
    })
    return clone
  }, [scene])

  // Wireframe Overlay Clone for anatomical grid effect
  const wireframeScene = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.material = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#7dd3fc'),
          wireframe: true,
          transparent: true,
          opacity: 0.35,
        })
      }
    })
    return clone
  }, [scene])

  // Frame Loop for Animations: Model Idle Floating & Heart Pulse
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()

    // Subtle breathing / idle floating motion
    if (modelRef.current) {
      modelRef.current.position.y = -1.15 + Math.sin(time * 1.5) * 0.02
    }

    // Dynamic Heart Pulse matching patient HR
    if (heartPulseRef.current) {
      const beatsPerSec = Math.max(40, hr) / 60
      const pulsePhase = (time * beatsPerSec * Math.PI * 2) % (Math.PI * 2)
      const scale = 1 + Math.pow(Math.sin(pulsePhase), 4) * 0.45
      heartPulseRef.current.scale.setScalar(scale)
    }
  })

  return (
    <group ref={modelRef} position={[0, -1.15, 0]} scale={[1.15, 1.15, 1.15]}>
      {/* Base Holographic Mesh */}
      <primitive object={clonedScene} />

      {/* Layered Wireframe Grid Mesh */}
      <primitive object={wireframeScene} />

      {/* Pulsing 3D Anatomical Heart Indicator (Left Chest) */}
      <group position={[-0.08, 1.18, 0.14]}>
        {/* Outer Pulsing Pink Glow Sphere */}
        <mesh ref={heartPulseRef}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshBasicMaterial color="#f43f5e" transparent opacity={0.6} />
        </mesh>
        {/* Core Emissive Heart Center */}
        <mesh>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshStandardMaterial color="#ffffff" emissive="#f43f5e" emissiveIntensity={3.5} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 2. Rotating 3D Holographic Platform & Scanning Line
// ---------------------------------------------------------------------------
function HolographicPlatform() {
  const outerRingRef = useRef<THREE.Mesh>(null)
  const innerRingRef = useRef<THREE.Mesh>(null)
  const scanLineRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()
    if (outerRingRef.current) outerRingRef.current.rotation.z = time * 0.35
    if (innerRingRef.current) innerRingRef.current.rotation.z = -time * 0.5
    if (scanLineRef.current) {
      scanLineRef.current.position.y = Math.sin(time * 1.8) * 1.1
    }
  })

  // Particles rising from platform
  const particleCount = 50
  const particlePositions = useMemo(() => {
    const pos = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1.8
      pos[i * 3 + 1] = Math.random() * 2.2 - 1.1
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.8
    }
    return pos
  }, [particleCount])

  return (
    <group position={[0, -1.2, 0]}>
      {/* Outer Rotating Scanning Ring */}
      <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.75, 0.88, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Inner Concentric Ring */}
      <mesh ref={innerRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.48, 32]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Ground Projection Glow Disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.88, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>

      {/* Vertical Animated Scanning Line */}
      <mesh ref={scanLineRef} position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.01, 0.75, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>

      {/* Floating Particles */}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.025} color="#7dd3fc" transparent opacity={0.6} />
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
      <p className="mt-1 text-[10px] text-slate-500">Loading holographic GLTF mesh matrix</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Main Exported 3D Hologram Canvas Component
// ---------------------------------------------------------------------------
export function Hologram3DCanvas({ hr = 74 }: Hologram3DProps) {
  return (
    <div className="relative h-[280px] w-full overflow-hidden rounded-2xl bg-[#000000] border border-cyan-500/20 shadow-inner">
      <Suspense fallback={<HologramLoadingState />}>
        <Canvas
          camera={{ position: [0, 0.15, 3.4], fov: 42 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
        >
          <color attach="background" args={['#010510']} />
          <ambientLight intensity={0.9} />
          <directionalLight position={[0, 4, 5]} intensity={2.5} color="#38bdf8" />
          <directionalLight position={[0, -2, -3]} intensity={1.2} color="#0284c7" />

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

'use client'

import { Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, OrbitControls, Sparkles, Html } from '@react-three/drei'
import * as THREE from 'three'

interface HologramHuman3DProps {
  hr: number
  spo2: number
  temp: number
  rr: number
}

// ---------------------------------------------------------------------------
// 3D GLB Holographic Human Model Mesh Component (Auto Bounding Box Scaled)
// ---------------------------------------------------------------------------
function HumanGlbModel({ hr }: { hr: number }) {
  const { scene } = useGLTF('/human-model.glb')
  const groupRef = useRef<THREE.Group>(null)
  const heartRef = useRef<THREE.Mesh>(null)
  const scanLineRef = useRef<THREE.Mesh>(null)

  const { clonedScene, targetScale, targetY, heartY } = useMemo(() => {
    const cloned = scene.clone(true)
    const box = new THREE.Box3().setFromObject(cloned)
    const size = new THREE.Vector3()
    box.getSize(size)

    const desiredHeight = 1.65
    const scale = size.y > 0 ? desiredHeight / size.y : 1
    const minY = box.min.y
    const yOffset = -minY * scale
    const heartHeight = yOffset + (size.y * scale * 0.72)

    return {
      clonedScene: cloned,
      targetScale: scale,
      targetY: yOffset,
      heartY: heartHeight,
    }
  }, [scene])

  useEffect(() => {
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#0284c7'),
          emissive: new THREE.Color('#38bdf8'),
          emissiveIntensity: 0.95,
          transparent: true,
          opacity: 0.7,
          roughness: 0.1,
          metalness: 0.8,
          wireframe: false,
          side: THREE.DoubleSide,
        })
      }
    })
  }, [clonedScene])

  const pulseSpeed = (hr / 60) * Math.PI * 2

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()

    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(time * 0.4) * 0.12
    }

    if (heartRef.current) {
      const pulse = 1 + Math.sin(time * pulseSpeed) * 0.25
      heartRef.current.scale.set(pulse, pulse, pulse)
      const mat = heartRef.current.material as THREE.MeshStandardMaterial
      if (mat) {
        mat.emissiveIntensity = 1.5 + Math.sin(time * pulseSpeed) * 1.2
      }
    }

    if (scanLineRef.current) {
      scanLineRef.current.position.y = (Math.sin(time * 1.5) + 1) * 0.8 + 0.1
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <primitive object={clonedScene} scale={targetScale} position={[0, targetY, 0]} />

      <mesh ref={heartRef} position={[-0.06, heartY, 0.12]}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial
          color="#f43f5e"
          emissive="#f43f5e"
          emissiveIntensity={2.5}
          transparent
          opacity={0.9}
        />
      </mesh>

      <mesh ref={scanLineRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]}>
        <ringGeometry args={[0.01, 0.65, 32]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

useGLTF.preload('/human-model.glb')

// ---------------------------------------------------------------------------
// Procedural Holographic Human Fallback
// ---------------------------------------------------------------------------
function ProceduralHologramFallback({ hr }: { hr: number }) {
  const groupRef = useRef<THREE.Group>(null)
  const heartRef = useRef<THREE.Mesh>(null)

  const pulseSpeed = (hr / 60) * Math.PI * 2

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(time * 0.5) * 0.15
    }
    if (heartRef.current) {
      const pulse = 1 + Math.sin(time * pulseSpeed) * 0.25
      heartRef.current.scale.set(pulse, pulse, pulse)
    }
  })

  const holoMat = new THREE.MeshStandardMaterial({
    color: '#0284c7',
    emissive: '#38bdf8',
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.65,
    wireframe: true,
  })

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <mesh position={[0, 1.55, 0]} material={holoMat}>
        <sphereGeometry args={[0.14, 16, 16]} />
      </mesh>
      <mesh position={[0, 1.1, 0]} material={holoMat}>
        <cylinderGeometry args={[0.22, 0.16, 0.7, 16]} />
      </mesh>
      <mesh position={[-0.3, 1.15, 0]} rotation={[0, 0, 0.15]} material={holoMat}>
        <cylinderGeometry args={[0.05, 0.04, 0.65, 12]} />
      </mesh>
      <mesh position={[0.3, 1.15, 0]} rotation={[0, 0, -0.15]} material={holoMat}>
        <cylinderGeometry args={[0.05, 0.04, 0.65, 12]} />
      </mesh>
      <mesh position={[-0.13, 0.4, 0]} material={holoMat}>
        <cylinderGeometry args={[0.07, 0.05, 0.75, 12]} />
      </mesh>
      <mesh position={[0.13, 0.4, 0]} material={holoMat}>
        <cylinderGeometry args={[0.07, 0.05, 0.75, 12]} />
      </mesh>
      <mesh ref={heartRef} position={[-0.06, 1.2, 0.1]}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial color="#f43f5e" emissive="#f43f5e" emissiveIntensity={2.5} />
      </mesh>
    </group>
  )
}

function HolographicPlatform() {
  const platformRef = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    if (platformRef.current) {
      platformRef.current.rotation.y = clock.getElapsedTime() * 0.35
    }
  })

  return (
    <group ref={platformRef} position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.68, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.38, 0.42, 32]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.65, 32]} />
        <meshBasicMaterial color="#0369a1" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function HologramLoadingHud() {
  return (
    <Html center>
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-black/80 px-4 py-3 backdrop-blur-md">
        <div className="size-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-300">
          INITIALIZING DIGITAL TWIN...
        </span>
      </div>
    </Html>
  )
}

// ---------------------------------------------------------------------------
// Main Exported 3D Hologram Component with Embed Mode & Three.js Canvas Mode
// ---------------------------------------------------------------------------
export function HologramHuman3D({ hr }: HologramHuman3DProps) {
  const [useEmbed, setUseEmbed] = useState(true)

  const pulseDuration = `${(60 / Math.max(40, hr)).toFixed(2)}s`

  return (
    <div className="relative h-[290px] w-full overflow-hidden rounded-2xl bg-[#010612]/90 border border-cyan-500/20 shadow-[inset_0_0_40px_rgba(56,189,248,0.08)]">
      
      {useEmbed ? (
        /* Direct Sketchfab 3D Embed Player (c06468c7f4444e08a397e90bc84381d3) */
        <div className="relative h-full w-full">
          <iframe
            title="Modern Human Skeletal Organs 3D Hologram"
            src="https://sketchfab.com/models/c06468c7f4444e08a397e90bc84381d3/embed?autostart=1&internal=1&tracking=0&ui_ar=0&ui_infos=0&ui_snapshots=1&ui_stop=0&ui_theatre=1&ui_watermark=0"
            className="h-full w-full border-0 pointer-events-auto"
            allow="autoplay; fullscreen; xr-spatial-tracking"
          />

          {/* Overlay HUD Scan Line */}
          <div
            className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent pointer-events-none animate-pulse"
            style={{ top: '35%', boxShadow: '0 0 12px rgba(56, 189, 248, 0.9)' }}
          />

          {/* Pulse Heart Indicator Overlay */}
          <div className="absolute top-[32%] left-[45%] pointer-events-none flex items-center justify-center">
            <div
              className="size-5 rounded-full bg-rose-500/60 animate-ping"
              style={{ animationDuration: pulseDuration }}
            />
            <div
              className="absolute size-3 rounded-full bg-rose-500 shadow-[0_0_12px_#f43f5e]"
              style={{ animationDuration: pulseDuration }}
            />
          </div>

          {/* Mode Switcher Button */}
          <button
            onClick={() => setUseEmbed(false)}
            className="absolute top-2 right-2 rounded-lg border border-cyan-500/30 bg-black/80 px-2 py-1 font-mono text-[9px] font-bold text-cyan-300 backdrop-blur-md hover:bg-cyan-500/20"
          >
            Switch to WebGL Mesh
          </button>
        </div>
      ) : (
        /* WebGL Three.js Canvas Viewport */
        <div className="relative h-full w-full">
          <Canvas
            camera={{ position: [0, 0.85, 2.5], fov: 45 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true }}
          >
            <color attach="background" args={['#010612']} />
            <ambientLight intensity={0.9} />
            <pointLight position={[0, 2, 3]} intensity={18} color="#38bdf8" />
            <pointLight position={[0, -1, -2]} intensity={8} color="#0284c7" />

            <Sparkles count={35} scale={2.5} size={1.8} speed={0.4} color="#38bdf8" />
            <HolographicPlatform />

            <Suspense fallback={<HologramLoadingHud />}>
              <HumanGlbModel hr={hr} />
            </Suspense>

            <OrbitControls
              enablePan={false}
              enableZoom={false}
              minPolarAngle={Math.PI / 3.5}
              maxPolarAngle={Math.PI / 1.8}
            />
          </Canvas>

          {/* Mode Switcher Button */}
          <button
            onClick={() => setUseEmbed(true)}
            className="absolute top-2 right-2 z-10 rounded-lg border border-cyan-500/30 bg-black/80 px-2 py-1 font-mono text-[9px] font-bold text-cyan-300 backdrop-blur-md hover:bg-cyan-500/20"
          >
            Switch to Sketchfab 3D
          </button>
        </div>
      )}
    </div>
  )
}

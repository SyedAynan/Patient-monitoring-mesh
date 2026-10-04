'use client'

import { Suspense, useMemo, useRef, useCallback, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, OrbitControls, Sparkles } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type VitalStatus = 'normal' | 'warning' | 'critical'

export interface HologramHuman3DProps {
  hr: number
  spo2: number
  temp: number
  rr: number
  onMarkerClick?: (vital: 'hr' | 'spo2' | 'rr' | 'temp') => void
  activeMarker?: 'hr' | 'spo2' | 'rr' | 'temp' | null
  getVitalStatus?: (vital: 'hr' | 'spo2' | 'rr' | 'temp') => VitalStatus
}

// ---------------------------------------------------------------------------
// Vital marker definitions & label placement sides
// ---------------------------------------------------------------------------
const VITAL_POSITIONS = {
  hr:   { heightFrac: 0.72, xOffset: -0.06, zOffset: 0.12, label: 'HR',   unit: 'bpm',    color: '#f43f5e', labelSide: 'left'  as const },
  spo2: { heightFrac: 0.70, xOffset:  0.12, zOffset: 0.12, label: 'SpO₂', unit: '%',      color: '#38bdf8', labelSide: 'right' as const },
  rr:   { heightFrac: 0.64, xOffset: -0.10, zOffset: 0.10, label: 'RR',   unit: 'br/min', color: '#8b5cf6', labelSide: 'left'  as const },
  temp: { heightFrac: 0.55, xOffset:  0.02, zOffset: 0.12, label: 'TEMP', unit: '°C',     color: '#fbbf24', labelSide: 'right' as const },
} as const

// ---------------------------------------------------------------------------
// Custom Holographic Fresnel Rim Shader Material
// ---------------------------------------------------------------------------
function createHologramMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#0ea5e9') },
      uEdgeColor: { value: new THREE.Color('#22d3ee') },
      uOpacity: { value: 0.45 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      varying float vY;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uEdgeColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying vec2 vUv;
      varying float vY;
      void main() {
        float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
        fresnel = pow(fresnel, 2.2);
        
        float scanline = smoothstep(0.48, 0.5, fract(vY * 35.0 + uTime * 0.9));
        float gridH = smoothstep(0.48, 0.5, fract(vY * 15.0));
        
        vec3 baseColor = mix(uColor * 0.45, uColor, 0.55 + scanline * 0.2);
        vec3 rimColor = uEdgeColor * (1.6 + sin(uTime * 2.0) * 0.3);
        vec3 finalColor = mix(baseColor, rimColor, fresnel);
        finalColor += uEdgeColor * gridH * 0.08;
        
        float alpha = uOpacity * (0.35 + fresnel * 0.65) + scanline * 0.06;
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
}

// ---------------------------------------------------------------------------
// Anatomical Wireframe Material
// ---------------------------------------------------------------------------
function createWireframeMaterial() {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color('#38bdf8'),
    wireframe: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  })
}

// ---------------------------------------------------------------------------
// 3D Vital Sensor Marker with sleek pulsing node & thin leader line
// ---------------------------------------------------------------------------
function VitalMarker3D({
  position, vital, value, unit, label, color, status, isActive, onClick, hr, labelSide,
}: {
  position: [number, number, number]
  vital: string; value: number; unit: string; label: string; color: string
  status: VitalStatus; isActive: boolean; onClick: () => void; hr: number
  labelSide: 'left' | 'right'
}) {
  const coreRef = useRef<THREE.Mesh>(null)
  const outerRef = useRef<THREE.Mesh>(null)

  let finalColor = color
  if (status === 'critical') finalColor = '#ef4444'
  else if (status === 'warning') finalColor = '#f97316'

  const pulseSpeed = vital === 'hr' ? (hr / 60) * Math.PI * 2 : 2.0
  const coreSize = isActive ? 0.035 : 0.024
  const glow = status === 'critical' ? 4.0 : status === 'warning' ? 3.0 : 1.8

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const pulse = 1 + Math.sin(t * pulseSpeed) * 0.2

    if (coreRef.current) {
      coreRef.current.scale.setScalar(pulse)
      const mat = coreRef.current.material as THREE.MeshStandardMaterial
      if (mat) {
        mat.emissiveIntensity = glow + Math.sin(t * pulseSpeed) * (glow * 0.3)
        mat.color.set(finalColor)
        mat.emissive.set(finalColor)
      }
    }
    if (outerRef.current) {
      outerRef.current.scale.setScalar(1 + Math.sin(t * pulseSpeed * 0.5) * 0.15)
      const mat = outerRef.current.material as THREE.MeshStandardMaterial
      if (mat) {
        mat.opacity = isActive ? 0.30 : 0.15
        mat.color.set(finalColor)
        mat.emissive.set(finalColor)
      }
    }
  })

  // Leader line extends outward to left/right margins outside torso
  const labelOffset = labelSide === 'left' ? -0.32 : 0.32

  return (
    <group position={position}>
      {/* Outer subtle glow ring */}
      <mesh ref={outerRef}>
        <sphereGeometry args={[coreSize * 2.2, 16, 16]} />
        <meshStandardMaterial color={finalColor} emissive={finalColor} emissiveIntensity={0.6} transparent opacity={0.12} depthWrite={false} />
      </mesh>

      {/* Core medical sensor node */}
      <mesh
        ref={coreRef}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = 'auto' }}
      >
        <sphereGeometry args={[coreSize, 16, 16]} />
        <meshStandardMaterial color={finalColor} emissive={finalColor} emissiveIntensity={glow} transparent opacity={0.9} />
      </mesh>

      {/* Thin leader line from sensor to HUD label */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, 0, 0, labelOffset, 0.02, -0.04]), 3]}
            count={2}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={finalColor} transparent opacity={isActive ? 0.85 : 0.4} />
      </line>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Screen Coordinate Projection Tracker for HUD Labels
// ---------------------------------------------------------------------------
function MarkerScreenPositionTracker({
  markerPositions,
  labelRefs,
}: {
  markerPositions: Record<string, [number, number, number]>
  labelRefs?: React.RefObject<Record<string, HTMLDivElement | null>>
}) {
  const tempVec = useRef(new THREE.Vector3())

  useFrame(({ camera }) => {
    if (!labelRefs?.current) return

    for (const key of Object.keys(VITAL_POSITIONS) as Array<'hr' | 'spo2' | 'rr' | 'temp'>) {
      const def = VITAL_POSITIONS[key]
      const pos = markerPositions[key]
      if (!pos) continue
      const labelOffset = def.labelSide === 'left' ? -0.32 : 0.32

      tempVec.current.set(pos[0] + labelOffset, pos[1] + 0.02, pos[2] - 0.04)
      tempVec.current.project(camera)

      const xPercent = (tempVec.current.x * 0.5 + 0.5) * 100
      const yPercent = (-tempVec.current.y * 0.5 + 0.5) * 100
      const isVisible = tempVec.current.z < 1

      const el = labelRefs.current[key]
      if (el) {
        if (isVisible) {
          el.style.display = 'flex'
          el.style.left = `${xPercent}%`
          el.style.top = `${yPercent}%`
        } else {
          el.style.display = 'none'
        }
      }
    }
  })

  return null
}

// ---------------------------------------------------------------------------
// FULL-BODY CONTINUOUS 3D HUMAN DIGITAL TWIN GLTF MODEL (WITH SKELETONUTILS)
// ---------------------------------------------------------------------------
function HumanGlbModel({
  hr, spo2, rr, temp, activeMarker, onMarkerClick, getVitalStatus, labelRefs,
}: {
  hr: number; spo2: number; rr: number; temp: number
  activeMarker?: string | null
  onMarkerClick?: (vital: 'hr' | 'spo2' | 'rr' | 'temp') => void
  getVitalStatus?: (vital: 'hr' | 'spo2' | 'rr' | 'temp') => VitalStatus
  labelRefs?: React.RefObject<Record<string, HTMLDivElement | null>>
}) {
  const { scene } = useGLTF('/human-model.glb')
  const scanBeamRef = useRef<THREE.Mesh>(null)
  const heartRef = useRef<THREE.Group>(null)
  const leftLungRef = useRef<THREE.Mesh>(null)
  const rightLungRef = useRef<THREE.Mesh>(null)

  // Use SkeletonUtils.clone to properly clone SkinnedMeshes without breaking skeleton bone bindings
  const { clonedScene, wireScene, targetScale, targetY, bodyHeight, markerPositions } = useMemo(() => {
    const cloned = SkeletonUtils.clone(scene)
    const wire = SkeletonUtils.clone(scene)

    const box = new THREE.Box3().setFromObject(cloned)
    const size = new THREE.Vector3()
    box.getSize(size)

    const desiredHeight = 1.72
    const scale = size.y > 0 ? desiredHeight / size.y : 1
    const minY = box.min.y
    const yOffset = -minY * scale

    // Position of telemetry markers anchored to model coordinates
    const markers: Record<string, [number, number, number]> = {
      hr:   [-0.06, yOffset + size.y * scale * 0.72, 0.12],
      spo2: [ 0.12, yOffset + size.y * scale * 0.70, 0.12],
      rr:   [-0.10, yOffset + size.y * scale * 0.64, 0.10],
      temp: [ 0.02, yOffset + size.y * scale * 0.55, 0.12],
    }

    return {
      clonedScene: cloned,
      wireScene: wire,
      targetScale: scale,
      targetY: yOffset,
      bodyHeight: size.y * scale,
      markerPositions: markers,
    }
  }, [scene])

  // Custom cyan holographic Fresnel shader material for main body
  const holoMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#0284c7') },
        uEdgeColor: { value: new THREE.Color('#38bdf8') },
        uOpacity: { value: 0.52 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;
        varying float vY;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          vY = position.y;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uEdgeColor;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec2 vUv;
        varying float vY;
        void main() {
          float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
          fresnel = pow(fresnel, 2.0);
          
          float scanline = smoothstep(0.48, 0.5, fract(vY * 40.0 + uTime * 0.8));
          float gridH = smoothstep(0.48, 0.5, fract(vY * 18.0));
          
          vec3 baseColor = mix(uColor * 0.5, uColor, 0.5 + scanline * 0.25);
          vec3 rimColor = uEdgeColor * (1.8 + sin(uTime * 2.0) * 0.3);
          vec3 finalColor = mix(baseColor, rimColor, fresnel);
          finalColor += uEdgeColor * gridH * 0.10;
          
          float alpha = uOpacity * (0.30 + fresnel * 0.70) + scanline * 0.05;
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  }, [])

  const wireMaterial = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      wireframe: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
  }, [])

  useEffect(() => {
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).material = holoMaterial
      }
    })
  }, [clonedScene, holoMaterial])

  useEffect(() => {
    wireScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).material = wireMaterial
      }
    })
  }, [wireScene, wireMaterial])

  const organMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#f43f5e',
    emissive: '#f43f5e',
    emissiveIntensity: 2.5,
    transparent: true,
    opacity: 0.90,
  }), [])

  const lungMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#0284c7',
    emissiveIntensity: 1.8,
    transparent: true,
    opacity: 0.80,
  }), [])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    holoMaterial.uniforms.uTime.value = t

    // Heartbeat pulse animation based on hr
    if (heartRef.current) {
      const beatFreq = (hr / 60) * Math.PI * 2
      const pulse = 1 + Math.sin(t * beatFreq) * 0.15
      heartRef.current.scale.setScalar(pulse)
    }

    // Breathing lung expansion animation based on rr
    if (leftLungRef.current && rightLungRef.current) {
      const breathFreq = (rr / 15) * Math.PI
      const breathScale = 1 + Math.sin(t * breathFreq) * 0.09
      leftLungRef.current.scale.set(breathScale, breathScale, breathScale * 1.05)
      rightLungRef.current.scale.set(breathScale, breathScale, breathScale * 1.05)
    }

    // Scanning beam sweep
    if (scanBeamRef.current) {
      const cycle = (Math.sin(t * 0.8) + 1) * 0.5
      scanBeamRef.current.position.y = targetY + bodyHeight * cycle
    }
  })

  const values = { hr, spo2, rr, temp }
  const defaultStatus: VitalStatus = 'normal'

  return (
    <group>
      {/* 1. Main Continuous 3D Human Body (Hologram Shader) */}
      <primitive object={clonedScene} scale={targetScale} position={[0, targetY, 0]} />

      {/* 2. Wireframe Overlay Mesh */}
      <primitive object={wireScene} scale={targetScale * 1.002} position={[0, targetY, 0]} />

      {/* 3. Internal Anatomical Organs & Structure (Heart, Lungs, Ribcage, Spine) */}
      <group position={[0, targetY + bodyHeight * 0.72, 0]}>
        {/* Heart */}
        <group ref={heartRef} position={[-0.05, 0, 0.04]}>
          <mesh material={organMaterial}>
            <sphereGeometry args={[0.046, 18, 18]} />
          </mesh>
          <mesh position={[0.01, 0.035, 0]} rotation={[0, 0, -0.4]} material={organMaterial}>
            <cylinderGeometry args={[0.016, 0.026, 0.045, 14]} />
          </mesh>
        </group>

        {/* Lungs (Left & Right) */}
        <mesh ref={leftLungRef} position={[-0.08, -0.01, 0.02]} material={lungMaterial}>
          <sphereGeometry args={[0.050, 18, 18]} />
        </mesh>
        <mesh ref={rightLungRef} position={[0.08, -0.01, 0.02]} material={lungMaterial}>
          <sphereGeometry args={[0.050, 18, 18]} />
        </mesh>

        {/* Ribcage Arches (Subtly visible inside chest) */}
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={`rib-${i}`} position={[0, -0.08 + i * 0.025, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.135 - i * 0.004, 0.005, 8, 28, Math.PI * 1.6]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} />
          </mesh>
        ))}
      </group>

      {/* Spine vertebrae beads */}
      <group position={[0, 0, 0]}>
        {Array.from({ length: 14 }).map((_, i) => (
          <mesh key={`spine-${i}`} position={[0, targetY + bodyHeight * (0.42 + i * 0.024), -0.04]}>
            <sphereGeometry args={[0.015, 8, 8]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.55} />
          </mesh>
        ))}
      </group>

      {/* Scanning beam ring */}
      <mesh ref={scanBeamRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.85, 0]}>
        <ringGeometry args={[0.46, 0.49, 64]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* 4. Vital Sensor Markers */}
      {(Object.keys(VITAL_POSITIONS) as Array<'hr' | 'spo2' | 'rr' | 'temp'>).map((key) => {
        const def = VITAL_POSITIONS[key]
        const pos = markerPositions[key] as [number, number, number]
        return (
          <VitalMarker3D
            key={key}
            position={pos}
            vital={key}
            value={values[key]}
            unit={def.unit}
            label={def.label}
            color={def.color}
            labelSide={def.labelSide}
            status={getVitalStatus ? getVitalStatus(key) : defaultStatus}
            isActive={activeMarker === key}
            onClick={() => onMarkerClick?.(key)}
            hr={hr}
          />
        )
      })}

      <MarkerScreenPositionTracker
        markerPositions={markerPositions}
        labelRefs={labelRefs}
      />
    </group>
  )
}

useGLTF.preload('/human-model.glb')

// ---------------------------------------------------------------------------
// Fallback HUD geometry while model loads
// ---------------------------------------------------------------------------
function HologramLoadingHud() {
  return (
    <mesh position={[0, 0.85, 0]}>
      <sphereGeometry args={[0.2, 16, 16]} />
      <meshBasicMaterial color="#0ea5e9" wireframe transparent opacity={0.3} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Holographic Platform Base
// ---------------------------------------------------------------------------
function HolographicPlatform() {
  const groupRef = useRef<THREE.Group>(null)
  const innerRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (groupRef.current) groupRef.current.rotation.y = t * 0.22
    if (innerRef.current) innerRef.current.rotation.y = -t * 0.45
  })

  return (
    <group position={[0, -0.01, 0]}>
      <group ref={groupRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.58, 0.63, 64]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.53, 0.55, 64]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0.25} side={THREE.DoubleSide} />
        </mesh>
      </group>

      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.40, 32]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>

      {[0.10, 0.18, 0.26, 0.34, 0.45, 0.52].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r, r + 0.004, 48]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.08 + (i % 2) * 0.05} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2
        const x1 = Math.cos(angle) * 0.08
        const z1 = Math.sin(angle) * 0.08
        const x2 = Math.cos(angle) * 0.60
        const z2 = Math.sin(angle) * 0.60
        return (
          <line key={`spoke-${i}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([x1, 0, z1, x2, 0, z2]), 3]}
                count={2}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#38bdf8" transparent opacity={0.12} />
          </line>
        )
      })}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <circleGeometry args={[0.65, 64]} />
        <meshBasicMaterial color="#0369a1" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Camera controller — smooth lerp to focused marker region
// ---------------------------------------------------------------------------
function CameraFocusController({
  activeMarker,
  markerFocusPositions,
}: {
  activeMarker: string | null
  markerFocusPositions: Record<string, { target: [number, number, number]; position: [number, number, number] }>
}) {
  const { camera } = useThree()
  const targetRef = useRef(new THREE.Vector3(0, 0.85, 0))
  const posRef = useRef(new THREE.Vector3(0, 0.85, 2.5))

  useFrame(() => {
    if (activeMarker && markerFocusPositions[activeMarker]) {
      const focus = markerFocusPositions[activeMarker]
      targetRef.current.lerp(new THREE.Vector3(...focus.target), 0.04)
      posRef.current.lerp(new THREE.Vector3(...focus.position), 0.04)
    } else {
      targetRef.current.lerp(new THREE.Vector3(0, 0.85, 0), 0.04)
      posRef.current.lerp(new THREE.Vector3(0, 0.85, 2.5), 0.04)
    }
    camera.position.copy(posRef.current)
    camera.lookAt(targetRef.current)
  })

  return null
}

// ---------------------------------------------------------------------------
// Main Exported Component
// ---------------------------------------------------------------------------
export function HologramHuman3D({
  hr, spo2, temp, rr,
  onMarkerClick,
  activeMarker = null,
  getVitalStatus,
}: HologramHuman3DProps) {
  const controlsRef = useRef<any>(null)
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const values: Record<string, number> = useMemo(() => ({ hr, spo2, rr, temp }), [hr, spo2, rr, temp])

  const handleResetView = useCallback(() => {
    if (controlsRef.current) controlsRef.current.reset()
    onMarkerClick?.(null as any)
  }, [onMarkerClick])

  const markerFocusPositions = useMemo(() => ({
    hr:   { target: [0, 1.25, 0] as [number, number, number],  position: [0.4, 1.25, 1.8] as [number, number, number] },
    spo2: { target: [0, 1.22, 0] as [number, number, number],  position: [-0.4, 1.22, 1.8] as [number, number, number] },
    rr:   { target: [0, 1.14, 0] as [number, number, number],  position: [0.4, 1.14, 1.8] as [number, number, number] },
    temp: { target: [0, 0.98, 0] as [number, number, number],  position: [-0.3, 1.0, 1.8] as [number, number, number] },
  }), [])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-cyan-500/20 shadow-[inset_0_0_60px_rgba(56,189,248,0.06)]" style={{ background: 'radial-gradient(ellipse at 50% 50%, #020d1f 0%, #010612 70%)' }}>

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-[1] opacity-[0.04]"
        style={{
          backgroundImage: 'linear-gradient(rgba(56,189,248,1) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Corner HUD framing */}
      <div className="absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 border-cyan-400/30 rounded-tl pointer-events-none z-[2]" />
      <div className="absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 border-cyan-400/30 rounded-tr pointer-events-none z-[2]" />
      <div className="absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 border-cyan-400/30 rounded-bl pointer-events-none z-[2]" />
      <div className="absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 border-cyan-400/30 rounded-br pointer-events-none z-[2]" />

      {/* Top-left HUD label */}
      <div className="absolute top-3 left-4 z-[2] pointer-events-none">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-500/60">DIGITAL TWIN · LIVE</p>
      </div>

      {/* Top-right status indicator */}
      <div className="absolute top-3 right-4 z-[2] pointer-events-none flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse" />
        <span className="font-mono text-[10px] font-bold text-cyan-500/60 uppercase">3D ACTIVE</span>
      </div>

      <Canvas
        camera={{ position: [0, 0.85, 2.5], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ touchAction: 'none' }}
      >
        <color attach="background" args={['#010612']} />

        <ambientLight intensity={0.6} />
        <pointLight position={[0, 2.5, 3]} intensity={12} color="#38bdf8" distance={8} />
        <pointLight position={[0, -1, -2.5]} intensity={5} color="#0284c7" distance={6} />
        <pointLight position={[-2.5, 1, 1.5]} intensity={4} color="#0e7490" distance={6} />
        <pointLight position={[2.5, 1.5, 0]} intensity={3} color="#06b6d4" distance={5} />
        <pointLight position={[0, -0.5, 1]} intensity={2} color="#164e63" distance={4} />

        <Sparkles count={30} scale={3} size={1.2} speed={0.25} color="#38bdf8" opacity={0.4} />
        <HolographicPlatform />

        <Suspense fallback={<HologramLoadingHud />}>
          <HumanGlbModel
            hr={hr} spo2={spo2} rr={rr} temp={temp}
            activeMarker={activeMarker}
            onMarkerClick={onMarkerClick}
            getVitalStatus={getVitalStatus}
            labelRefs={labelRefs}
          />
        </Suspense>

        <CameraFocusController
          activeMarker={activeMarker}
          markerFocusPositions={markerFocusPositions}
        />

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          enableZoom={true}
          minDistance={1.4}
          maxDistance={4.5}
          minPolarAngle={Math.PI / 5}
          maxPolarAngle={Math.PI / 1.5}
          autoRotate={!activeMarker}
          autoRotateSpeed={0.5}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      {/* 2D HUD floating overlay labels tracked to 3D model outer margins */}
      <div className="absolute inset-0 pointer-events-none z-[10] overflow-hidden">
        {(Object.keys(VITAL_POSITIONS) as Array<'hr' | 'spo2' | 'rr' | 'temp'>).map((key) => {
          const def = VITAL_POSITIONS[key]
          const val = values[key]
          const isActive = activeMarker === key

          return (
            <div
              key={key}
              ref={(el) => { labelRefs.current[key] = el }}
              onClick={() => onMarkerClick?.(key)}
              className={`absolute pointer-events-auto cursor-pointer flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono backdrop-blur-md transition-all duration-150 -translate-x-1/2 -translate-y-1/2 select-none ${
                isActive
                  ? 'border-cyan-400 bg-black/90 shadow-[0_0_15px_rgba(56,189,248,0.4)] scale-105 ring-1 ring-cyan-400/50'
                  : 'border-white/12 bg-black/80 hover:border-cyan-400/40 hover:bg-black/90'
              }`}
              style={{ color: def.color, fontSize: '10px' }}
            >
              <span className="font-bold uppercase tracking-wider text-[9px] text-slate-300">{def.label}</span>
              <span className="text-white font-extrabold" style={{ color: def.color }}>{val}</span>
              <span className="text-slate-400 text-[8px]">{def.unit}</span>
            </div>
          )
        })}
      </div>

      {/* Bottom control bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 z-[3]">
        <button
          onClick={handleResetView}
          className="rounded-lg border border-cyan-500/30 bg-black/85 px-3 py-1.5 font-mono text-[10px] font-bold text-cyan-300 backdrop-blur-md hover:bg-cyan-500/20 hover:border-cyan-400/50 transition-all shadow-[0_0_12px_rgba(0,0,0,0.5)]"
        >
          ↻ RESET VIEW
        </button>
      </div>

      {/* Animated vertical scanline */}
      <div
        className="absolute top-0 bottom-0 w-px pointer-events-none z-[1]"
        style={{
          background: 'linear-gradient(to bottom, transparent 10%, rgba(56,189,248,0.4) 50%, transparent 90%)',
          boxShadow: '0 0 8px rgba(56,189,248,0.5)',
          animation: 'scanlineH 6s linear infinite',
        }}
      />

      <style>{`
        @keyframes scanlineH {
          0% { left: 0%; }
          50% { left: 100%; }
          100% { left: 0%; }
        }
      `}</style>
    </div>
  )
}

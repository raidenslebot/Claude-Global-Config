// A harbour basin you move through as you scroll: lit from an HDRI, the water a
// transmission material, the moorings instanced, the buoys deforming on the swell.
// Fixture: a plausible 3D scene that exercises the vocabulary.

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  Environment, ContactShadows, Instances, Instance, ScrollControls, useScroll,
  Text3D, useCursor,
} from '@react-three/drei'
import { EffectComposer, Bloom, DepthOfField, N8AO, ToneMapping } from '@react-three/postprocessing'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

// One seeded arrangement per load, reproducible from the number alone.
function moorings(seed = 7) {
  let s = seed
  const rand = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
  return Array.from({ length: 240 }, () => [
    (rand() - 0.5) * 40, 0, (rand() - 0.5) * 26,
  ])
}

// Geometry built from a rule rather than loaded: the basin floor follows the same
// curve the tide model uses.
function useBasinFloor() {
  return useMemo(() => {
    const g = new THREE.BufferGeometry()
    const size = 96
    const pos = new Float32Array(size * size * 3)
    for (let i = 0, k = 0; i < size; i++) {
      for (let j = 0; j < size; j++, k += 3) {
        const x = (i / size - 0.5) * 40
        const z = (j / size - 0.5) * 26
        pos[k] = x; pos[k + 1] = Math.sin(x * 0.3) * Math.cos(z * 0.22) * 0.4 - 2; pos[k + 2] = z
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])
}

function Water() {
  const mat = useRef()
  // A custom material: the difference between a rendered object and a grey ball.
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[60, 40, 1, 1]} />
      <meshTransmissionMaterial
        ref={mat} thickness={1.2} roughness={0.24} transmission={1} ior={1.33}
        onBeforeCompile={(shader) => { shader.uniforms.uTime = { value: 0 } }}
      />
    </mesh>
  )
}

function Buoys() {
  const skinned = useRef()
  useFrame((state, dt) => {
    // The swell deforms the geometry rather than transforming the object.
    if (skinned.current) skinned.current.morphTargetInfluences[0] = 0.5 + Math.sin(state.clock.elapsedTime) * 0.5
  })
  return <skinnedMesh ref={skinned} castShadow />
}

function Camera() {
  const scroll = useScroll()
  const { camera } = useThree()
  useFrame(() => {
    // Damped, so the viewer moves through the basin rather than being teleported.
    const target = new THREE.Vector3(0, 2 + scroll.offset * 3, 14 - scroll.offset * 22)
    camera.position.lerp(target, 0.06)
    camera.lookAt(0, 0, 0)
  })
  return null
}

export default function Basin() {
  const floor = useBasinFloor()
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])

  return (
    <Canvas shadows dpr={[1, 2]} raycaster={raycaster}>
      <Environment files="basin.hdr" background blur={0.6} />
      <directionalLight castShadow position={[6, 10, 4]} shadow-mapSize={[2048, 2048]} />
      <ContactShadows opacity={0.5} scale={40} blur={2.4} far={12} />

      <ScrollControls pages={3} damping={0.2}>
        <Camera />
        <Water />
        <Buoys />
        <mesh geometry={floor} />

        {/* One draw call for every mooring ring in the basin. */}
        <Instances limit={400} castShadow>
          <torusGeometry args={[0.18, 0.05, 8, 24]} />
          <meshStandardMaterial color="#1f2a44" />
          {moorings().map((p) => (
            <Instance key={p.join(",")} position={p} onPointerOver={() => setHovered(true)} />
          ))}
        </Instances>

        <Text3D font="/archivo.json" size={0.6} height={0.08} position={[-6, 3, 0]}>
          OUTER BASIN
        </Text3D>
      </ScrollControls>

      <EffectComposer>
        <N8AO intensity={1.1} />
        <DepthOfField focusDistance={0.02} focalLength={0.05} bokehScale={2.4} />
        <Bloom intensity={0.35} luminanceThreshold={0.85} />
        <ToneMapping />
      </EffectComposer>
    </Canvas>
  )
}

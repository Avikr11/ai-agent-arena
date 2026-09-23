"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

type Props = {
  change24h?: number;
  roundProgress?: number;
  userPrediction?: "UP" | "DOWN" | null;
  roundClosed?: boolean;
};

/* =========================================================
   COLOR SYSTEM
   - Base tint shifts from lime (neutral) → teal (BTC up) → coral (BTC down)
   - Round end triggers a brighter "flare"
   ========================================================= */
function useSceneTint(change24h: number) {
  return useMemo(() => {
    const neutral = new THREE.Color("#9fbf5a");
    const up = new THREE.Color("#7ddc8f");
    const down = new THREE.Color("#ff8b94");

    if (change24h > 0.5) {
      const strength = Math.min(1, Math.abs(change24h) / 3);
      return neutral.clone().lerp(up, 0.4 + strength * 0.4);
    }
    if (change24h < -0.5) {
      const strength = Math.min(1, Math.abs(change24h) / 3);
      return neutral.clone().lerp(down, 0.3 + strength * 0.4);
    }
    return neutral;
  }, [change24h]);
}

/* =========================================================
   GRID FLOOR — reactive tint + slow scroll
   ========================================================= */
function GridFloor({ tint }: { tint: THREE.Color }) {
  const ref = useRef<THREE.GridHelper>(null);
  const currentColor = useRef(new THREE.Color("#d4f57a"));

  useFrame((_, delta) => {
    if (!ref.current) return;

    // scroll forward
    ref.current.position.z = (ref.current.position.z + delta * 1.2) % 4;

    // ease color
    currentColor.current.lerp(tint, 0.02);
    const mat = ref.current.material as THREE.Material | THREE.Material[];
    const matArr = Array.isArray(mat) ? mat : [mat];
    matArr.forEach((m) => {
      if ("color" in m) {
        (m as THREE.LineBasicMaterial).color.copy(currentColor.current);
      }
    });
  });

  return (
    <gridHelper
      ref={ref}
      args={[60, 60, "#d4f57a", "#1a1f14"]}
      position={[0, -2, 0]}
    />
  );
}

/* =========================================================
   STAGE RING — breathes; pulses hard on round close
   ========================================================= */
function StageRing({
  tint,
  roundClosed = false,
}: {
  tint: THREE.Color;
  roundClosed?: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const currentColor = useRef(new THREE.Color("#d4f57a"));

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const pulse = roundClosed ? 1 + Math.sin(t * 8) * 0.15 : 1;
    const breathe = 1 + Math.sin(t * 1.2) * 0.02;
    ref.current.scale.set(pulse * breathe, 1, pulse * breathe);

    currentColor.current.lerp(tint, 0.03);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.color.copy(currentColor.current);
  });

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.98, 0]}>
      <ringGeometry args={[4.4, 4.55, 96]} />
      <meshBasicMaterial
        color="#d4f57a"
        transparent
        opacity={0.45}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* =========================================================
   VERSUS BEAM — vertical glowing pillar at the center
   Grows with round progress; color = current market bias
   ========================================================= */
function VersusBeam({
  tint,
  roundProgress = 0,
  roundClosed = false,
}: {
  tint: THREE.Color;
  roundProgress?: number;
  roundClosed?: boolean;
}) {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const currentColor = useRef(new THREE.Color("#d4f57a"));

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    currentColor.current.lerp(tint, 0.02);

    if (outerRef.current) {
      const height = 3 + roundProgress * 4;
      outerRef.current.scale.y = height / 3;
      const mat = outerRef.current.material as THREE.MeshBasicMaterial;
      mat.color.copy(currentColor.current);

      // subtle shimmer on round end
      if (roundClosed) {
        mat.opacity = 0.35 + Math.sin(t * 8) * 0.15;
      } else {
        mat.opacity = 0.25 + Math.sin(t * 1.5) * 0.05;
      }
    }

    if (innerRef.current) {
      innerRef.current.scale.y = (3 + roundProgress * 4) / 3;
      const mat = innerRef.current.material as THREE.MeshBasicMaterial;
      mat.color.copy(currentColor.current);
      mat.opacity = roundClosed
        ? 0.7 + Math.sin(t * 8) * 0.2
        : 0.55 + Math.sin(t * 1.5) * 0.05;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* outer softer beam */}
      <mesh ref={outerRef} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 3, 24, 1, true]} />
        <meshBasicMaterial
          color="#d4f57a"
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* inner bright core */}
      <mesh ref={innerRef} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 3, 16, 1, true]} />
        <meshBasicMaterial
          color="#d4f57a"
          transparent
          opacity={0.45}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* =========================================================
   PARTICLES — reactive tint, upward drift
   ========================================================= */
function Particles({ tint, count = 900 }: { tint: THREE.Color; count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 1] = Math.random() * 14 - 3;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.02;
    const pos = ref.current.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + delta * 0.35;
      if (y > 11) y = -3;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    const mat = ref.current.material as THREE.PointsMaterial;
    mat.color.lerp(tint, 0.02);
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        color="#9fbf5a"
      />
    </points>
  );
}

/* =========================================================
   PREDICTION ORBS — grow when user picks
   ========================================================= */
function PredictionOrbs({
  userPrediction,
}: {
  userPrediction?: "UP" | "DOWN" | null;
}) {
  const upRef = useRef<THREE.Mesh>(null);
  const downRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const angle = t * 0.15;

    if (upRef.current) {
      upRef.current.position.x = Math.cos(angle) * 5.5;
      upRef.current.position.z = Math.sin(angle) * 5.5;
      upRef.current.position.y = 0.6 + Math.sin(t * 0.9) * 0.3;
      const target = userPrediction === "UP" ? 1.6 : 1;
      upRef.current.scale.lerp(new THREE.Vector3(target, target, target), 0.08);
    }

    if (downRef.current) {
      downRef.current.position.x = Math.cos(angle + Math.PI) * 5.5;
      downRef.current.position.z = Math.sin(angle + Math.PI) * 5.5;
      downRef.current.position.y = 0.6 + Math.sin(t * 0.9 + Math.PI) * 0.3;
      const target = userPrediction === "DOWN" ? 1.6 : 1;
      downRef.current.scale.lerp(
        new THREE.Vector3(target, target, target),
        0.08,
      );
    }
  });

  return (
    <>
      <mesh ref={upRef}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshBasicMaterial color="#7ddc8f" />
      </mesh>
      <mesh ref={downRef}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshBasicMaterial color="#ff8b94" />
      </mesh>
    </>
  );
}

/* =========================================================
   CAMERA — slow cinematic drift + impact shake on round close
   ========================================================= */
function CameraRig({ roundClosed = false }: { roundClosed?: boolean }) {
  const shakeRef = useRef(0);
  const prevClosed = useRef(false);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // trigger a short shake when round transitions to closed
    if (roundClosed && !prevClosed.current) {
      shakeRef.current = 0.35; // seconds of shake
    }
    prevClosed.current = roundClosed;

    let shakeX = 0;
    let shakeY = 0;
    if (shakeRef.current > 0) {
      shakeRef.current = Math.max(0, shakeRef.current - delta);
      const decay = shakeRef.current / 0.35;
      const amp = 0.25 * decay;
      shakeX = (Math.random() - 0.5) * amp;
      shakeY = (Math.random() - 0.5) * amp;
    }

    state.camera.position.x = Math.sin(t * 0.08) * 1.5 + shakeX;
    state.camera.position.y = 1.2 + Math.sin(t * 0.13) * 0.3 + shakeY;
    state.camera.position.z = 9 + Math.cos(t * 0.1) * 0.6;
    state.camera.lookAt(0, 0.2, 0);
  });

  return null;
}

/* =========================================================
   SCENE
   ========================================================= */
function Scene({
  change24h = 0,
  roundProgress = 0,
  userPrediction = null,
  roundClosed = false,
  isMobile = false,
}: Props & { isMobile?: boolean }) {
  const tint = useSceneTint(change24h);

  return (
    <>
      <fog attach="fog" args={["#05070a", 8, 32]} />

      <ambientLight intensity={0.4} />
      <pointLight position={[0, 6, 0]} intensity={1.2} color="#d4f57a" />

      <GridFloor tint={tint} />
      <StageRing tint={tint} roundClosed={roundClosed} />
      <VersusBeam
        tint={tint}
        roundProgress={roundProgress}
        roundClosed={roundClosed}
      />
      <Particles tint={tint} count={isMobile ? 350 : 900} />
      <PredictionOrbs userPrediction={userPrediction} />
      <CameraRig roundClosed={roundClosed} />
    </>
  );
}

/* =========================================================
   PUBLIC EXPORT
   ========================================================= */
export default function ArenaBackground3D({
  change24h = 0,
  roundProgress = 0,
  userPrediction = null,
  roundClosed = false,
}: Props) {
  return (
    <div
      className="arena-3d-layer"
      aria-hidden="true"
      style={{ background: "radial-gradient(ellipse at center, transparent 30%, rgba(5,7,10,0.55) 100%)" }}
    >
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 1.2, 9], fov: 55 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
      >
        <Scene
          change24h={change24h}
          roundProgress={roundProgress}
          userPrediction={userPrediction}
          roundClosed={roundClosed}
        />
      </Canvas>
    </div>
  );
}
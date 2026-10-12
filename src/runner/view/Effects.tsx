import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import type { RunnerController } from "../controller";
import { shouldPuffDust, speedLineOpacity } from "../juice";

const SPARKS = 8;
const DUST = 8;
const LINES = 4;

interface Spark {
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function resetSpark(spark: Spark, x: number, seed: number): void {
  const angle = seed * 6.1;
  spark.life = 0.18 + (seed % 1) * 0.16;
  spark.x = x;
  spark.y = 0.28;
  spark.z = 0.15;
  spark.vx = Math.sin(angle) * 1.4;
  spark.vy = 1.2 + (seed % 0.4);
  spark.vz = 0.4 + Math.cos(angle);
}

function resetDust(dust: Spark, x: number, seed: number): void {
  const angle = seed * 4.3;
  dust.life = 0.28 + (seed % 1) * 0.2;
  dust.x = x + Math.sin(angle) * 0.22;
  dust.y = 0.05;
  dust.z = 0.04;
  dust.vx = Math.sin(angle) * 0.65;
  dust.vy = 0.5 + (seed % 0.25);
  dust.vz = Math.cos(angle) * 0.3;
}

/**
 * Speed lines, grind sparks, and a landing puff. Nothing is allocated
 * while the run is moving. All three stay hidden when the player asked
 * for reduced motion.
 */
export function Effects({ controller, reducedMotion }: { controller: RunnerController; reducedMotion: boolean }) {
  const sparks = useRef<Spark[]>(
    Array.from({ length: SPARKS }, (_, index) => {
      const spark: Spark = { life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
      resetSpark(spark, 0, index + 1);
      return spark;
    }),
  );
  const dust = useRef<Spark[]>(
    Array.from({ length: DUST }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })),
  );
  const sparkMeshes = useRef<(Mesh | null)[]>([]);
  const dustMeshes = useRef<(Mesh | null)[]>([]);
  const lines = useRef<(Mesh | null)[]>([]);
  const wasGrind = useRef(false);

  useFrame((_, dt) => {
    const state = controller.getState();
    const playing = state.status === "playing";
    const grinding = state.onGrind || state.duck >= 0;
    const emit = grinding && playing && !reducedMotion;
    for (let i = 0; i < SPARKS; i += 1) {
      const mesh = sparkMeshes.current[i];
      const spark = sparks.current[i];
      if (!mesh || !spark) continue;
      spark.life -= dt;
      if (spark.life <= 0) {
        if (!emit) {
          mesh.visible = false;
          continue;
        }
        resetSpark(spark, state.x, state.distance * 0.17 + i * 0.37);
      }
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.z += spark.vz * dt;
      spark.vy -= dt * 3.2;
      mesh.visible = emit || spark.life > 0;
      mesh.position.set(spark.x, spark.y, spark.z);
    }

    const puff = shouldPuffDust(wasGrind.current, state.onGrind, reducedMotion, playing);
    wasGrind.current = state.onGrind;
    for (let i = 0; i < DUST; i += 1) {
      const mesh = dustMeshes.current[i];
      const mote = dust.current[i];
      if (!mesh || !mote) continue;
      if (reducedMotion) {
        mote.life = 0;
        mesh.visible = false;
        continue;
      }
      if (puff) resetDust(mote, state.x, state.distance * 0.13 + i * 0.41);
      mote.life -= dt;
      if (mote.life <= 0) {
        mesh.visible = false;
        continue;
      }
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      mote.z += mote.vz * dt;
      mote.vy -= dt * 1.4;
      mesh.visible = true;
      mesh.position.set(mote.x, Math.max(0.04, mote.y), mote.z);
      const material = mesh.material as MeshBasicMaterial;
      material.opacity = Math.min(0.45, mote.life);
    }

    const opacity = speedLineOpacity(state.speed, reducedMotion, playing);
    for (let i = 0; i < LINES; i += 1) {
      const mesh = lines.current[i];
      if (!mesh) continue;
      mesh.visible = opacity > 0;
      mesh.position.set(state.x + (i - 1.5) * 0.22, 0.35 + (i % 2) * 0.18, 1.15);
      const material = mesh.material as MeshBasicMaterial;
      material.opacity = opacity;
    }
  });

  return (
    <group>
      {Array.from({ length: SPARKS }, (_, index) => (
        <mesh
          key={index}
          ref={(node) => {
            sparkMeshes.current[index] = node;
          }}
          visible={false}
        >
          <octahedronGeometry args={[0.035, 0]} />
          <meshBasicMaterial color="#ffb15a" />
        </mesh>
      ))}
      {Array.from({ length: DUST }, (_, index) => (
        <mesh
          key={`dust-${index}`}
          ref={(node) => {
            dustMeshes.current[index] = node;
          }}
          visible={false}
        >
          <octahedronGeometry args={[0.045, 0]} />
          <meshBasicMaterial color="#cbb79a" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
      {Array.from({ length: LINES }, (_, index) => (
        <mesh
          key={`line-${index}`}
          ref={(node) => {
            lines.current[index] = node;
          }}
          visible={false}
        >
          <boxGeometry args={[0.015, 0.015, 0.7 + index * 0.15]} />
          <meshBasicMaterial color="#f3e2b0" transparent opacity={0.15} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

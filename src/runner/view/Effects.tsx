import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, MeshBasicMaterial } from "three";
import type { RunnerController } from "../controller";

const SPARKS = 8;
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

/**
 * Speed lines and a handful of reused spark meshes. Nothing is allocated
 * while the run is moving. Both stay hidden when the player asked for
 * reduced motion.
 */
export function Effects({
  controller,
  reducedMotion,
}: {
  controller: RunnerController;
  reducedMotion: boolean;
}) {
  const sparks = useRef<Spark[]>(
    Array.from({ length: SPARKS }, (_, index) => {
      const spark: Spark = { life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
      resetSpark(spark, 0, index + 1);
      return spark;
    }),
  );
  const sparkMeshes = useRef<(Mesh | null)[]>([]);
  const lines = useRef<(Mesh | null)[]>([]);

  useFrame((_, dt) => {
    const state = controller.getState();
    const grinding = state.onGrind || state.duck >= 0;
    const emit = grinding && state.status === "playing" && !reducedMotion;
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

    const showLines = !reducedMotion && state.status === "playing" && state.speed > 9.2;
    const opacity = Math.min(0.28, (state.speed - 9.2) / 10);
    for (let i = 0; i < LINES; i += 1) {
      const mesh = lines.current[i];
      if (!mesh) continue;
      mesh.visible = showLines;
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
      {Array.from({ length: LINES }, (_, index) => (
        <mesh
          key={`line-${index}`}
          ref={(node) => {
            lines.current[index] = node;
          }}
          visible={false}
        >
          <boxGeometry args={[0.015, 0.015, 0.7 + index * 0.15]} />
          <meshBasicMaterial color="#f4efe6" transparent opacity={0.15} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

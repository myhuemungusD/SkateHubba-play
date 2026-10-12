import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { LANE_X, SEGMENT_LENGTH } from "../constants";
import type { RunnerController } from "../controller";

const SEGMENTS = [0, 1, 2] as const;

/**
 * Three street slabs repositioned as the run moves. The meshes are created
 * once and recycled, which is the whole "endless street" — nothing is
 * allocated per meter.
 */
export function Street({ controller }: { controller: RunnerController }) {
  const group = useRef<Group>(null);

  useFrame(() => {
    const root = group.current;
    if (!root) return;
    const distance = controller.getState().distance;
    const index = Math.floor(distance / SEGMENT_LENGTH);
    for (let i = 0; i < SEGMENTS.length; i += 1) {
      const slab = root.children[i];
      if (!slab) continue;
      // One slab sits behind the skater so the camera is not looking at a hole.
      const center = (index - 1 + i) * SEGMENT_LENGTH + SEGMENT_LENGTH / 2;
      slab.position.z = -(center - distance);
    }
  });

  return (
    <group ref={group}>
      {SEGMENTS.map((index) => (
        <group key={index}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={false}>
            <planeGeometry args={[8.4, SEGMENT_LENGTH]} />
            <meshLambertMaterial color="#2a2a2a" />
          </mesh>
          {LANE_X.slice(0, 2).map((laneX, line) => (
            <mesh key={line} position={[(laneX + (LANE_X[line + 1] ?? laneX)) / 2, 0.01, 0]}>
              <boxGeometry args={[0.04, 0.02, SEGMENT_LENGTH]} />
              <meshLambertMaterial color="#6d6d6d" />
            </mesh>
          ))}
          <mesh position={[-3.55, 0.9, -8]}>
            <boxGeometry args={[1.3, 1.8, 6]} />
            <meshLambertMaterial color={index === 1 ? "#242424" : "#1c1c1c"} />
          </mesh>
          <mesh position={[3.55, 1.15, 6]}>
            <boxGeometry args={[1.3, 2.3, 5]} />
            <meshLambertMaterial color={index === 2 ? "#262626" : "#1a1a1a"} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

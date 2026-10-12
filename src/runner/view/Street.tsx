import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { SEGMENT_LENGTH } from "../constants";
import type { RunnerController } from "../controller";
import { flatMaterial, roadMaterial, sidewalkMaterial } from "./textures";

const SEGMENTS = [0, 1, 2] as const;
const curb = flatMaterial("#5e5954");
const building = flatMaterial("#3c434c");
const buildingAlt = flatMaterial("#343a42");
const windowMat = flatMaterial("#1b242c", "#0c1218");
const dash = flatMaterial("#d8d2c4");

/**
 * Three street slabs repositioned as the run moves. Meshes and textures are
 * created once. The ground is concrete, the edges are a curb and sidewalk,
 * and the blocks behind them are a low street wall — no per-meter allocation.
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
      const center = (index - 1 + i) * SEGMENT_LENGTH + SEGMENT_LENGTH / 2;
      slab.position.z = -(center - distance);
    }
  });

  return (
    <group ref={group}>
      {SEGMENTS.map((index) => (
        <group key={index}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={roadMaterial()}>
            <planeGeometry args={[5.4, SEGMENT_LENGTH]} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.7, 0.06, 0]} material={sidewalkMaterial()}>
            <planeGeometry args={[2.1, SEGMENT_LENGTH]} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.7, 0.06, 0]} material={sidewalkMaterial()}>
            <planeGeometry args={[2.1, SEGMENT_LENGTH]} />
          </mesh>
          <mesh position={[-2.55, 0.05, 0]} material={curb}>
            <boxGeometry args={[0.16, 0.1, SEGMENT_LENGTH]} />
          </mesh>
          <mesh position={[2.55, 0.05, 0]} material={curb}>
            <boxGeometry args={[0.16, 0.1, SEGMENT_LENGTH]} />
          </mesh>
          {[-12, -4, 4, 12].map((z) => (
            <mesh key={z} position={[0, 0.015, z]} material={dash}>
              <boxGeometry args={[0.08, 0.02, 1.4]} />
            </mesh>
          ))}
          <mesh position={[-4.3, 1.15, -6]} material={index === 1 ? buildingAlt : building}>
            <boxGeometry args={[1.1, 2.3, 8]} />
          </mesh>
          <mesh position={[-4.3, 1.35, -6]} material={windowMat}>
            <boxGeometry args={[0.08, 0.7, 5]} />
          </mesh>
          <mesh position={[4.35, 1.45, 8]} material={index === 2 ? building : buildingAlt}>
            <boxGeometry args={[1.15, 2.9, 7]} />
          </mesh>
          <mesh position={[4.35, 1.7, 8]} material={windowMat}>
            <boxGeometry args={[0.08, 0.9, 4.2]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

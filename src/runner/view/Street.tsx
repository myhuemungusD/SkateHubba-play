import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Group } from "three";
import { SEGMENT_LENGTH } from "../constants";
import type { RunnerController } from "../controller";
import type { RunnerQuality } from "../quality";
import { AlleyProps } from "./AlleyProps";
import { useSkateparkScenery } from "./skatepark";
import { brickBuildingMaterial, brickMaterial, flatMaterial, roadMaterial, sidewalkMaterial } from "./textures";

const SEGMENTS = [0, 1, 2] as const;
const curb = flatMaterial("#5e5954");
const wall = brickMaterial();
const building = brickBuildingMaterial();
const windowMat = flatMaterial("#1b242c", "#0c1218");
const dash = flatMaterial("#d8d2c4");

/**
 * Three street slabs repositioned as the run moves. Meshes are created once.
 * The road is asphalt, the edges are concrete, and a brick wall sits behind
 * the sidewalk. No per-meter allocation.
 */
export function Street({ controller, quality }: { controller: RunnerController; quality: RunnerQuality }) {
  const high = quality === "high";
  const group = useRef<Group>(null);
  const gl = useThree((state) => state.gl);
  useSkateparkScenery(group, gl);

  useFrame(() => {
    const root = group.current;
    if (!root) return;
    const distance = controller.getRenderFrame().distance;
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
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={roadMaterial()} receiveShadow={high}>
            <planeGeometry args={[5.4, SEGMENT_LENGTH]} />
          </mesh>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[-3.7, 0.06, 0]}
            material={sidewalkMaterial()}
            receiveShadow={high}
          >
            <planeGeometry args={[2.1, SEGMENT_LENGTH]} />
          </mesh>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[3.7, 0.06, 0]}
            material={sidewalkMaterial()}
            receiveShadow={high}
          >
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
          <mesh position={[-5.15, 1.15, 0]} material={wall} receiveShadow={high}>
            <boxGeometry args={[0.35, 2.3, SEGMENT_LENGTH]} />
          </mesh>
          <mesh position={[5.15, 1.15, 0]} material={wall} receiveShadow={high}>
            <boxGeometry args={[0.35, 2.3, SEGMENT_LENGTH]} />
          </mesh>
          <mesh position={[-4.3, 1.15, -6]} material={building} receiveShadow={high}>
            <boxGeometry args={[1.1, 2.3, 8]} />
          </mesh>
          <mesh position={[-4.3, 1.35, -6]} material={windowMat}>
            <boxGeometry args={[0.08, 0.7, 5]} />
          </mesh>
          {index === 0 ? null : (
            <mesh position={[4.35, 1.45, 8]} material={building} receiveShadow={high}>
              <boxGeometry args={[1.15, 2.9, 7]} />
            </mesh>
          )}
          {index === 0 ? null : (
            <mesh position={[4.35, 1.7, 8]} material={windowMat}>
              <boxGeometry args={[0.08, 0.9, 4.2]} />
            </mesh>
          )}
          <group name="park-scenery" />
          <AlleyProps index={index} high={high} />
        </group>
      ))}
    </group>
  );
}

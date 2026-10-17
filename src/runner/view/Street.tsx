import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Group } from "three";
import { SEGMENT_LENGTH } from "../constants";
import type { RunnerController } from "../controller";
import type { RunnerQuality } from "../quality";
import { AlleyProps } from "./AlleyProps";
import { useSkateparkScenery } from "./skatepark";
import { brickBuildingMaterial, flatMaterial } from "./textures";
import { GroundInstances } from "./streetInstances";

const SEGMENTS = [0, 1, 2] as const;
const building = brickBuildingMaterial();
const windowMat = flatMaterial("#1b242c", "#0c1218");

/**
 * Three street slabs repositioned as the run moves. The road, sidewalks,
 * curbs, walls, and dashes are instanced. Buildings and lamps stay on the
 * recycled slabs. No per-meter allocation.
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
    <>
      <GroundInstances controller={controller} quality={quality} />
      <group ref={group}>
        {SEGMENTS.map((index) => (
          <group key={index}>
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
    </>
  );
}

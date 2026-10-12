import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshBasicMaterial, type Group } from "three";
import type { RunnerController } from "../controller";
import { sampleAt } from "../ghost";

const ghost = new MeshBasicMaterial({
  color: "#f2c14a",
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
});

/**
 * The best run on this device, drawn at the distance you are at now.
 * It disappears once you roll past that run. It is not a saved score.
 */
export function GhostBoard({ controller }: { controller: RunnerController }) {
  const root = useRef<Group>(null);

  useFrame(() => {
    const group = root.current;
    if (!group) return;
    const state = controller.getState();
    const frame = controller.getRenderFrame();
    const sample = state.status === "playing" ? sampleAt(controller.getGhost(), frame.distance) : null;
    if (!sample) {
      group.visible = false;
      return;
    }
    const overlap = Math.abs(sample.x - frame.x) < 0.25;
    group.visible = true;
    group.position.set(overlap ? sample.x + 0.55 : sample.x, Math.max(sample.y, 0.02) + 0.04, 0.15);
  });

  return (
    <group ref={root} visible={false} name="GhostBoard">
      <mesh position={[0, 0.26, 0]} material={ghost}>
        <boxGeometry args={[0.5, 0.045, 1.15]} />
      </mesh>
      <mesh position={[0, 0.16, -0.42]} rotation={[0, 0, Math.PI / 2]} material={ghost}>
        <cylinderGeometry args={[0.08, 0.08, 0.46, 8]} />
      </mesh>
      <mesh position={[0, 0.16, 0.42]} rotation={[0, 0, Math.PI / 2]} material={ghost}>
        <cylinderGeometry args={[0.08, 0.08, 0.46, 8]} />
      </mesh>
    </group>
  );
}

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Object3D } from "three";
import { LANE_X, RAIL_LENGTH } from "../constants";
import type { RunnerController } from "../controller";
import type { Obstacle, ObstacleKind } from "../types";

const POOL = 32;
const KINDS: readonly ObstacleKind[] = ["cone", "barrier", "overhead", "rail"];

function showKind(group: Object3D, kind: ObstacleKind): void {
  for (const name of KINDS) {
    const child = group.getObjectByName(name);
    if (child) child.visible = name === kind;
  }
}

function visibleObstacles(obstacles: readonly Obstacle[], distance: number): Obstacle[] {
  const shown: Obstacle[] = [];
  for (const obstacle of obstacles) {
    if (obstacle.z + obstacle.length < distance - 6) continue;
    if (obstacle.z > distance + 72) continue;
    shown.push(obstacle);
    if (shown.length === POOL) break;
  }
  return shown;
}

/** Fixed pool of low-poly props. Slots are hidden and reused as the street scrolls. */
export function ObstaclePool({ controller }: { controller: RunnerController }) {
  const slots = useRef<(Group | null)[]>([]);

  useFrame(() => {
    const state = controller.getState();
    const shown = visibleObstacles(state.obstacles, state.distance);
    for (let i = 0; i < POOL; i += 1) {
      const slot = slots.current[i];
      const obstacle = shown[i];
      if (!slot) continue;
      if (!obstacle) {
        slot.visible = false;
        continue;
      }
      slot.visible = true;
      slot.position.set(LANE_X[obstacle.lane], 0, -(obstacle.z - state.distance));
      showKind(slot, obstacle.kind);
      if (obstacle.kind === "rail") {
        const rail = slot.getObjectByName("rail");
        if (rail) {
          const length = obstacle.length > 0 ? obstacle.length : RAIL_LENGTH;
          rail.scale.z = length / RAIL_LENGTH;
          rail.position.z = -length / 2;
        }
      }
    }
  });

  return (
    <group>
      {Array.from({ length: POOL }, (_, index) => (
        <group
          key={index}
          ref={(node) => {
            slots.current[index] = node;
          }}
          visible={false}
        >
          <mesh name="cone" position={[0, 0.28, 0]} castShadow={false}>
            <coneGeometry args={[0.28, 0.55, 6]} />
            <meshLambertMaterial color="#ff6b00" />
          </mesh>
          <mesh name="barrier" position={[0, 0.55, 0]} visible={false} castShadow={false}>
            <boxGeometry args={[0.95, 1.1, 0.4]} />
            <meshLambertMaterial color="#ff3d00" />
          </mesh>
          <group name="overhead" visible={false}>
            <mesh position={[-0.46, 0.6, 0]}>
              <boxGeometry args={[0.08, 1.2, 0.08]} />
              <meshLambertMaterial color="#d5d5d5" />
            </mesh>
            <mesh position={[0.46, 0.6, 0]}>
              <boxGeometry args={[0.08, 1.2, 0.08]} />
              <meshLambertMaterial color="#d5d5d5" />
            </mesh>
            <mesh position={[0, 1.18, 0]}>
              <boxGeometry args={[1.15, 0.1, 0.1]} />
              <meshLambertMaterial color="#f4f4f4" />
            </mesh>
          </group>
          <mesh name="rail" position={[0, 0.28, -RAIL_LENGTH / 2]} visible={false} castShadow={false}>
            <boxGeometry args={[0.14, 0.08, RAIL_LENGTH]} />
            <meshLambertMaterial color="#c5ccd1" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

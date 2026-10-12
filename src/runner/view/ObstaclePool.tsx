import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Object3D } from "three";
import { BOX_LENGTH, LANE_X, RAIL_LENGTH } from "../constants";
import type { RunnerController } from "../controller";
import type { RunnerQuality } from "../quality";
import type { Obstacle, ObstacleKind } from "../types";
import { ledgeMaterial, metalMaterial, postMaterial, waxMaterial } from "./textures";

const POOL = 16;
const KINDS: readonly ObstacleKind[] = ["rail", "box"];
const post = postMaterial();
const railMetal = metalMaterial();
const ledge = ledgeMaterial();
const coping = metalMaterial();

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
    if (obstacle.z > distance + 64) continue;
    shown.push(obstacle);
    if (shown.length === POOL) break;
  }
  return shown;
}

function stretch(group: Object3D, name: string, length: number, base: number): void {
  const mesh = group.getObjectByName(name);
  if (!mesh) return;
  mesh.scale.z = length / base;
  mesh.position.z = -length / 2;
}

/** Fixed pool of rails and waxed ledges. Slots are hidden and reused. */
export function ObstaclePool({ controller, quality }: { controller: RunnerController; quality: RunnerQuality }) {
  const high = quality === "high";
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
      const kind = slot.getObjectByName(obstacle.kind);
      if (!kind) continue;
      if (obstacle.kind === "rail") {
        stretch(kind, "rail-beam", obstacle.length, RAIL_LENGTH);
        const far = kind.getObjectByName("rail-post-far");
        if (far) far.position.z = -obstacle.length;
      } else {
        stretch(kind, "box-body", obstacle.length, BOX_LENGTH);
        stretch(kind, "box-wax", obstacle.length, BOX_LENGTH);
        stretch(kind, "box-coping", obstacle.length, BOX_LENGTH);
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
          <group name="rail">
            <mesh
              name="rail-beam"
              position={[0, 0.42, -RAIL_LENGTH / 2]}
              material={railMetal}
              castShadow={high}
              receiveShadow={high}
            >
              <boxGeometry args={[0.18, 0.12, RAIL_LENGTH]} />
            </mesh>
            <mesh name="rail-post-near" position={[0, 0.2, 0]} material={post} castShadow={high}>
              <boxGeometry args={[0.1, 0.4, 0.1]} />
            </mesh>
            <mesh name="rail-post-far" position={[0, 0.2, -RAIL_LENGTH]} material={post} castShadow={high}>
              <boxGeometry args={[0.1, 0.4, 0.1]} />
            </mesh>
          </group>
          <group name="box" visible={false}>
            <mesh
              name="box-body"
              position={[0, 0.16, -BOX_LENGTH / 2]}
              material={ledge}
              castShadow={high}
              receiveShadow={high}
            >
              <boxGeometry args={[0.85, 0.32, BOX_LENGTH]} />
            </mesh>
            <mesh name="box-wax" position={[0, 0.325, -BOX_LENGTH / 2]} material={waxMaterial()}>
              <boxGeometry args={[0.72, 0.02, BOX_LENGTH]} />
            </mesh>
            <mesh name="box-coping" position={[0.34, 0.3, -BOX_LENGTH / 2]} material={coping} castShadow={high}>
              <boxGeometry args={[0.08, 0.05, BOX_LENGTH]} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

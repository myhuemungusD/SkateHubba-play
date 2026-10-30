import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mesh, type Object3D } from "three";
import { resetSlots } from "./art-slots-test-helpers";
import { fakeController, render3D, unmountAll3D, type Scene3D } from "./r3f-test-helpers";
import { ObstaclePool } from "../ObstaclePool";
import { BOX_LENGTH, LANE_X, RAIL_LENGTH } from "../../constants";
import type { Obstacle } from "../../types";

vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);

beforeEach(() => {
  resetSlots();
});

afterEach(unmountAll3D);

function obstacle(partial: Partial<Obstacle>): Obstacle {
  return {
    id: 0,
    kind: "rail",
    lane: 1,
    z: 10,
    length: RAIL_LENGTH,
    awarded: false,
    passed: false,
    ...partial,
  } as Obstacle;
}

function poolSlots(scene3d: Scene3D): Object3D[] {
  return [...(scene3d.state().scene.children[0]?.children ?? [])];
}

function part(slot: Object3D | undefined, name: string): Object3D {
  const found = slot?.getObjectByName(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
}

async function mount(obstacles: Obstacle[], distance = 0, quality: "high" | "low" = "low") {
  const controller = fakeController({ obstacles } as never, { distance });
  const scene = await render3D(<ObstaclePool controller={controller} quality={quality} />);
  return { controller, scene, slots: poolSlots(scene) };
}

describe("ObstaclePool", () => {
  it("builds sixteen hidden slots, each with a rail and a waxed box", async () => {
    const { slots } = await mount([]);
    expect(slots).toHaveLength(16);
    for (const slot of slots) {
      expect(slot.visible).toBe(false);
      for (const name of [
        "rail-beam",
        "rail-post-near",
        "rail-post-far",
        "rail-model",
        "box-body",
        "box-wax",
        "box-coping",
        "box-model",
      ]) {
        expect(part(slot, name)).toBeDefined();
      }
    }
    expect((part(slots[0], "rail-beam") as Mesh).castShadow).toBe(false);
  });

  it("casts shadows from the rails and ledges on the high tier", async () => {
    const { slots } = await mount([], 0, "high");
    const beam = part(slots[0], "rail-beam") as Mesh;
    const body = part(slots[0], "box-body") as Mesh;
    expect([beam.castShadow, beam.receiveShadow, body.castShadow, body.receiveShadow]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("places a rail in its lane, stretched to its length, with the far post at the end", async () => {
    const { scene: s, slots } = await mount([obstacle({ lane: 0, z: 30, length: 14 })], 10);
    await s.frame();
    const slot = slots[0] as Object3D;
    expect(slot.visible).toBe(true);
    expect(slot.position.toArray()).toEqual([LANE_X[0], 0, -20]);
    expect(part(slot, "rail").visible).toBe(true);
    expect(part(slot, "box").visible).toBe(false);
    const beam = part(slot, "rail-beam");
    expect(beam.scale.z).toBeCloseTo(14 / RAIL_LENGTH);
    expect(beam.position.z).toBeCloseTo(-7);
    expect(part(slot, "rail-model").scale.z).toBeCloseTo(2);
    expect(part(slot, "rail-post-far").position.z).toBe(-14);
    expect(slots.slice(1).every((other) => !other.visible)).toBe(true);
  });

  it("places a box, stretching its body, wax, and coping", async () => {
    const { scene: s, slots } = await mount([obstacle({ kind: "box", lane: 2, z: 5, length: 7.2 })]);
    await s.frame();
    const slot = slots[0] as Object3D;
    expect(slot.position.toArray()).toEqual([LANE_X[2], 0, -5]);
    expect(part(slot, "box").visible).toBe(true);
    expect(part(slot, "rail").visible).toBe(false);
    for (const name of ["box-body", "box-wax", "box-coping"]) {
      expect(part(slot, name).scale.z).toBeCloseTo(7.2 / BOX_LENGTH);
      expect(part(slot, name).position.z).toBeCloseTo(-3.6);
    }
  });

  it("only shows obstacles from 6 m behind to 64 m ahead, at most sixteen", async () => {
    const behind = obstacle({ id: 1, z: 80, length: 3 });
    const ahead = obstacle({ id: 2, z: 165 });
    const near = Array.from({ length: 20 }, (_, i) => obstacle({ id: 10 + i, z: 100 + i }));
    const { controller, scene: s, slots } = await mount([behind, ahead, ...near], 100);
    await s.frame();
    expect(slots.every((slot) => slot.visible)).toBe(true);
    // The first shown is the first near one: the passed and far ones were skipped.
    expect(slots[0]?.position.z).toBeCloseTo(0);
    expect(slots[15]?.position.z).toBeCloseTo(-15);

    controller.state.obstacles = [obstacle({ z: 120 })];
    await s.frame();
    expect(slots.filter((slot) => slot.visible)).toHaveLength(1);
  });

  it("keeps going when a slot is missing parts a loader swapped out", async () => {
    const { scene: s, slots } = await mount([
      obstacle({ id: 1, z: 10, length: 14 }),
      obstacle({ id: 2, z: 12, kind: "box" }),
      obstacle({ id: 3, z: 14 }),
    ]);
    const first = slots[0] as Object3D;
    part(first, "rail-model").removeFromParent();
    part(first, "rail-post-far").removeFromParent();
    part(first, "box").removeFromParent();
    part(slots[1], "box").removeFromParent();
    await s.frame();
    expect(part(first, "rail-beam").scale.z).toBeCloseTo(14 / RAIL_LENGTH);
    expect(part(first, "rail").visible).toBe(true);
    // A box obstacle on a slot with no box: placed, nothing to stretch.
    expect(slots[1]?.visible).toBe(true);
    expect(part(slots[1], "rail").visible).toBe(false);
    expect(slots[2]?.visible).toBe(true);
  });

  it("ignores a frame once the slots unmount", async () => {
    const rail = obstacle({});
    const { scene: s, slots } = await mount([rail]);
    await s.frame();
    const first = slots[0] as Object3D;
    const placed = first.position.toArray();
    expect(first.visible).toBe(true);
    const late = s.captureFrame();
    await s.unmount();
    // A live frame would move the slot to the new z.
    rail.z = 30;
    late();
    expect(first.position.toArray()).toEqual(placed);
    expect(first.visible).toBe(true);
  });
});

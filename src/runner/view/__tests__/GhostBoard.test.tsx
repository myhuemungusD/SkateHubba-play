import { afterEach, describe, expect, it } from "vitest";
import type { Group } from "three";
import { GhostBoard } from "../GhostBoard";
import { fakeController, render3D, type Scene3D } from "./r3f-test-helpers";

let scene: Scene3D | null = null;
afterEach(async () => {
  await scene?.unmount();
  scene = null;
});

const bestRun = [
  { d: 0, x: 0, y: 0 },
  { d: 10, x: 2, y: 1 },
  { d: 20, x: -2, y: 0 },
];

async function mountGhost(
  state: Parameters<typeof fakeController>[0] = {},
  frame: Parameters<typeof fakeController>[1] = {},
) {
  const controller = fakeController(state, frame);
  controller.getGhost = () => bestRun;
  scene = await render3D(<GhostBoard controller={controller} />);
  return { controller, ghost: () => scene?.find("GhostBoard") as Group };
}

describe("GhostBoard", () => {
  it("stays hidden with no best run", async () => {
    const controller = fakeController();
    scene = await render3D(<GhostBoard controller={controller} />);
    await scene.frame();
    expect(scene.find("GhostBoard").visible).toBe(false);
    expect(controller.getGhost).toHaveBeenCalled();
  });

  it("draws the best run where it was at the current distance", async () => {
    const { ghost } = await mountGhost({}, { distance: 5, x: -1.5 });
    await scene?.frame();
    expect(ghost().visible).toBe(true);
    // Halfway between the first two samples, lifted 4cm off the ground.
    expect(ghost().position.x).toBeCloseTo(1);
    expect(ghost().position.y).toBeCloseTo(0.54);
    expect(ghost().position.z).toBeCloseTo(0.15);
  });

  it("steps aside when it would sit on the live board, and never sinks below the floor", async () => {
    const { ghost } = await mountGhost({}, { distance: 0, x: 0.1 });
    await scene?.frame();
    expect(ghost().position.x).toBeCloseTo(0.55);
    // y = 0 is clamped to 0.02 before the 0.04 lift.
    expect(ghost().position.y).toBeCloseTo(0.06);
  });

  it("disappears once you roll past the best run", async () => {
    const { controller, ghost } = await mountGhost({}, { distance: 5 });
    await scene?.frame();
    expect(ghost().visible).toBe(true);
    controller.frame.distance = 25;
    await scene?.frame();
    expect(ghost().visible).toBe(false);
  });

  it("hides outside a live run", async () => {
    const { ghost } = await mountGhost({ status: "gameover" } as never, { distance: 5 });
    await scene?.frame();
    expect(ghost().visible).toBe(false);
  });

  it("ignores a frame that lands after unmount", async () => {
    const { controller } = await mountGhost({}, { distance: 5 });
    const late = scene?.captureFrame();
    await scene?.unmount();
    scene = null;
    controller.frame.distance = 6;
    expect(() => late?.()).not.toThrow();
  });
});

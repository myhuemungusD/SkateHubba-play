import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mesh } from "three";
import { resetSlots, slots } from "./art-slots-test-helpers";
import { fakeController, render3D, unmountAll3D, type Scene3D } from "./r3f-test-helpers";
import { Board } from "../Board";

vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);

const WHEELS = ["WheelNoseLeft", "WheelNoseRight", "WheelTailLeft", "WheelTailRight"];

beforeEach(() => {
  resetSlots();
});

afterEach(unmountAll3D);

function meshes(scene3d: Scene3D): Mesh[] {
  const list: Mesh[] = [];
  scene3d.find("BoardRig").traverse((obj) => {
    if (obj instanceof Mesh) list.push(obj);
  });
  return list;
}

describe("Board", () => {
  it("builds the procedural deck with four named wheels and the graphic plane", async () => {
    slots.mikeWhite = "mike.png";
    const scene = await render3D(<Board controller={fakeController()} quality="low" />);
    for (const name of [...WHEELS, "Deck", "DeckNose", "DeckTail", "Griptape", "TruckNose", "TruckTail", "Graphic"]) {
      expect(scene.find(name)).toBeDefined();
    }
    expect(scene.find("WheelNoseLeft").position.toArray()).toEqual([-0.38, 0.15, -0.46]);
    expect(scene.find("WheelTailRight").position.toArray()).toEqual([0.38, 0.15, 0.46]);
    expect(scene.find("LogoDecal").visible).toBe(false);
    expect(scene.find("BoardRig").userData.mikeWhiteBoard).toBe("mike.png");
    // Low quality leaves shadows off.
    expect(meshes(scene).some((mesh) => mesh.castShadow)).toBe(false);
  });

  it("casts and receives shadows on every board mesh at high quality", async () => {
    const scene = await render3D(<Board controller={fakeController()} quality="high" />, { shadows: true });
    expect(meshes(scene).every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
  });

  it("poses the rig from the render frame and squashes it on landing", async () => {
    const controller = fakeController({}, { x: 1.5, y: 2, pitch: 0.1, yaw: 0.2, roll: 0.3, spin: 0.25, squash: 0.5 });
    const scene = await render3D(<Board controller={controller} quality="low" />);
    await scene.frame(0.1);
    const rig = scene.find("BoardRig");
    expect(rig.position.x).toBeCloseTo(1.5);
    expect(rig.position.y).toBeCloseTo(2 - 0.5 * 0.05);
    expect(rig.position.z).toBe(0);
    expect(rig.scale.x).toBeCloseTo(1.4 * 1.2);
    expect(rig.scale.y).toBeCloseTo(1.4 * 0.5);
    expect(rig.scale.z).toBeCloseTo(1.4 * 1.08);
    expect(rig.rotation.x).toBeCloseTo(0.1);
    expect(rig.rotation.y).toBeCloseTo(0.2);
    expect(rig.rotation.z).toBeCloseTo(0.3 + 0.25 * Math.PI * 2);

    const shadow = rig.parent?.children[0] as Mesh;
    expect(shadow.position.x).toBeCloseTo(1.5);
    expect(shadow.visible).toBe(true);
    controller.state.status = "gameover" as never;
    await scene.frame(0.1);
    expect(shadow.visible).toBe(false);
  });

  it("spins all four wheels together at the speed and state rate", async () => {
    const controller = fakeController({}, { speed: 8 });
    const scene = await render3D(<Board controller={controller} quality="low" />);
    await scene.frame(0.1);
    for (const name of WHEELS) expect(scene.find(name).rotation.x).toBeCloseTo(8 * 0.1 * 1.7);
    controller.state.onGrind = true;
    await scene.frame(0.1);
    for (const name of WHEELS) expect(scene.find(name).rotation.x).toBeCloseTo(8 * 0.1 * (1.7 + 0.9));
  });

  it("does nothing on a frame that lands after unmount", async () => {
    const scene = await render3D(<Board controller={fakeController()} quality="low" />);
    const late = scene.captureFrame();
    const wheel = scene.find("WheelNoseLeft");
    await scene.unmount();
    expect(() => late(0.1)).not.toThrow();
    expect(wheel.rotation.x).toBe(0);
  });
});

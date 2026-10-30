import { afterEach, describe, expect, it, vi } from "vitest";
import { InstancedMesh, Matrix4, MeshStandardMaterial, Vector3 } from "three";
import { fakeController, render3D, type Scene3D } from "./r3f-test-helpers";
import { Effects } from "../Effects";
import { speedLineOpacity } from "../../juice";

let scene: Scene3D | null = null;

afterEach(async () => {
  await scene?.unmount();
  scene = null;
});

interface Draws {
  sparks: InstancedMesh;
  dust: InstancedMesh;
  lines: InstancedMesh;
}

function draws(scene3d: Scene3D): Draws {
  const [sparks, dust, lines] = scene3d.state().scene.children[0]?.children as InstancedMesh[];
  return { sparks: sparks as InstancedMesh, dust: dust as InstancedMesh, lines: lines as InstancedMesh };
}

function scaleAt(mesh: InstancedMesh, index: number): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixScale(matrix);
}

function visibleCount(mesh: InstancedMesh): number {
  let count = 0;
  for (let i = 0; i < mesh.count; i += 1) if (scaleAt(mesh, i).x > 0) count += 1;
  return count;
}

async function mount(reducedMotion = false, state = {}, frame = {}) {
  const controller = fakeController(state, frame);
  scene = await render3D(<Effects controller={controller} reducedMotion={reducedMotion} />);
  return { controller, scene, ...draws(scene) };
}

describe("Effects", () => {
  it("builds three instanced draws with fixed counts", async () => {
    const { sparks, dust, lines } = await mount();
    expect([sparks.count, dust.count, lines.count]).toEqual([12, 8, 6]);
    expect(sparks.frustumCulled).toBe(false);
  });

  it("throws sparks up and back while grinding, then lets them die out", async () => {
    const { controller, scene: s, sparks } = await mount(false, { onGrind: true }, { x: 0.5, distance: 3 });
    const version = sparks.instanceMatrix.version;
    await s.frame(0.05);
    expect(visibleCount(sparks)).toBe(12);
    // needsUpdate bumps the version so the GPU copy refreshes.
    expect(sparks.instanceMatrix.version).toBe(version + 1);
    const before = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(sparks.instanceMatrix.array, 0));
    await s.frame(0.05);
    const after = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(sparks.instanceMatrix.array, 0));
    expect(after.y).toBeGreaterThan(before.y);

    controller.state.onGrind = false;
    for (let i = 0; i < 12; i += 1) await s.frame(0.05);
    expect(visibleCount(sparks)).toBe(0);
  });

  it("counts a duck under a rail as grinding", async () => {
    const { scene: s, sparks } = await mount(false, { duck: 0 });
    await s.frame(0.01);
    expect(visibleCount(sparks)).toBe(12);
  });

  it("keeps sparks off when the run is not playing or motion is reduced", async () => {
    const paused = await mount(false, { onGrind: true, status: "paused" });
    await paused.scene.frame(0.5);
    expect(visibleCount(paused.sparks)).toBe(0);
    await scene?.unmount();

    const calm = await mount(true, { onGrind: true });
    await calm.scene.frame(0.5);
    expect(visibleCount(calm.sparks)).toBe(0);
  });

  it("puffs dust when a grind ends and fades it with the motes", async () => {
    const { controller, scene: s, dust } = await mount(false, { onGrind: true }, { x: 1 });
    await s.frame(0.01);
    expect(visibleCount(dust)).toBe(0);
    expect((dust.material as MeshStandardMaterial).opacity).toBe(0);

    controller.state.onGrind = false;
    await s.frame(0.01);
    expect(visibleCount(dust)).toBe(8);
    const opacity = (dust.material as MeshStandardMaterial).opacity;
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(0.45);
    // Motes never sink under the street.
    for (let i = 0; i < 40; i += 1) await s.frame(0.02);
    expect(visibleCount(dust)).toBe(0);
    expect((dust.material as MeshStandardMaterial).opacity).toBe(0);
  });

  it("clears live dust at once under reduced motion", async () => {
    const controller = fakeController({ onGrind: true });
    scene = await render3D(<Effects controller={controller} reducedMotion={false} />);
    await scene.frame(0.01);
    controller.state.onGrind = false;
    await scene.frame(0.01);
    expect(visibleCount(draws(scene).dust)).toBe(8);
    await scene.rerender(<Effects controller={controller} reducedMotion />);
    await scene.frame(0.01);
    expect(visibleCount(draws(scene).dust)).toBe(0);
  });

  it("draws speed lines only above the start speed, longer toward the back", async () => {
    const { controller, scene: s, lines } = await mount(false, {}, { speed: 30, x: 0 });
    await s.frame(0.01);
    expect((lines.material as MeshStandardMaterial).opacity).toBeCloseTo(speedLineOpacity(30, false, true));
    expect((lines.material as MeshStandardMaterial).opacity).toBeGreaterThan(0);
    expect(scaleAt(lines, 0).z).toBeCloseTo(0.7);
    expect(scaleAt(lines, 5).z).toBeCloseTo(0.7 + 5 * 0.18);
    const matrix = new Matrix4();
    lines.getMatrixAt(1, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([
      expect.closeTo(-0.3),
      expect.closeTo(0.53),
      expect.closeTo(1.2),
    ]);

    controller.frame.speed = 0;
    await s.frame(0.01);
    expect((lines.material as MeshStandardMaterial).opacity).toBe(0);
    expect(visibleCount(lines)).toBe(0);
  });

  it("leaves a swapped-in non-basic material alone", async () => {
    const { controller, scene: s, dust, lines } = await mount(false, { onGrind: true }, { speed: 30 });
    const dustSwap = new MeshStandardMaterial({ opacity: 0.9 });
    const lineSwap = new MeshStandardMaterial({ opacity: 0.8 });
    dust.material = dustSwap;
    lines.material = lineSwap;
    await s.frame(0.01);
    controller.state.onGrind = false;
    await s.frame(0.01);
    expect(dustSwap.opacity).toBe(0.9);
    expect(lineSwap.opacity).toBe(0.8);
  });

  it("skips a frame once the draws are gone and frees its GPU objects on unmount", async () => {
    const { scene: s, sparks, dust, lines } = await mount(false, { onGrind: true });
    const late = s.captureFrame();
    const freed = [sparks.geometry, dust.geometry, lines.geometry, sparks.material, dust.material, lines.material].map(
      (item) => vi.spyOn(item as { dispose: () => void }, "dispose"),
    );
    await s.unmount();
    scene = null;
    for (const spy of freed) expect(spy).toHaveBeenCalled();
    const untouched = Array.from(sparks.instanceMatrix.array);
    expect(() => late(0.1)).not.toThrow();
    expect(Array.from(sparks.instanceMatrix.array)).toEqual(untouched);
  });
});

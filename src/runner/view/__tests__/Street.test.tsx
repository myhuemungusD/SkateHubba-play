import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from "three";
import { resetSlots } from "./art-slots-test-helpers";
import { fakeController, render3D, type Scene3D } from "./r3f-test-helpers";
import { Street } from "../Street";
import { AlleyProps } from "../AlleyProps";
import { GroundInstances } from "../streetInstances";
import { SEGMENT_LENGTH } from "../../constants";

vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);

let scene: Scene3D | null = null;

beforeEach(() => {
  resetSlots();
  // brandArt paints posters on a 2D canvas; jsdom has none, so it falls back to flat art.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(async () => {
  await scene?.unmount();
  scene = null;
  vi.restoreAllMocks();
});

function positionAt(mesh: InstancedMesh, index: number): number[] {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixPosition(matrix).toArray();
}

function meshesUnder(root: Object3D): Mesh[] {
  const list: Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof Mesh && !(obj instanceof InstancedMesh)) list.push(obj);
  });
  return list;
}

describe("GroundInstances", () => {
  it("lays road, sidewalks, curbs, walls, and dashes for three slabs around the board", async () => {
    const controller = fakeController({}, { distance: 50 });
    scene = await render3D(<GroundInstances controller={controller} quality="high" />);
    const [road, walk, curb, wall, dash] = scene.state().scene.children[0]?.children as InstancedMesh[];
    expect([road, walk, curb, wall, dash].map((mesh) => mesh?.count)).toEqual([3, 6, 6, 6, 12]);
    expect([road, walk, curb, wall, dash].map((mesh) => mesh?.receiveShadow)).toEqual([true, true, false, true, false]);

    await scene.frame();
    // distance 50 is in slab 1, so slabs are centred at 20, 60 and 100 m.
    const z = [30, -10, -50];
    for (let slot = 0; slot < 3; slot += 1) {
      expect(positionAt(road as InstancedMesh, slot)).toEqual([0, 0, expect.closeTo(z[slot] as number)]);
      expect(positionAt(walk as InstancedMesh, slot)[0]).toBeCloseTo(-3.7);
      expect(positionAt(walk as InstancedMesh, 3 + slot)[0]).toBeCloseTo(3.7);
      expect(positionAt(curb as InstancedMesh, slot)[0]).toBeCloseTo(-2.55);
      expect(positionAt(curb as InstancedMesh, 3 + slot)[0]).toBeCloseTo(2.55);
      expect(positionAt(wall as InstancedMesh, slot)[0]).toBeCloseTo(-5.15);
      expect(positionAt(wall as InstancedMesh, 3 + slot)[0]).toBeCloseTo(5.15);
    }
    expect([0, 1, 2, 3].map((mark) => positionAt(dash as InstancedMesh, 4 + mark)[2])).toEqual(
      [-12, -4, 4, 12].map((offset) => expect.closeTo(-10 + offset)),
    );
  });

  it("skips shadows on the phone tier, frees geometry on unmount, and ignores a late frame", async () => {
    scene = await render3D(<GroundInstances controller={fakeController()} quality="low" />);
    const draws = scene.state().scene.children[0]?.children as InstancedMesh[];
    expect(draws.some((mesh) => mesh.receiveShadow)).toBe(false);
    const freed = draws.map((mesh) => vi.spyOn(mesh.geometry, "dispose"));
    const late = scene.captureFrame();
    await scene.unmount();
    scene = null;
    for (const spy of freed) expect(spy).toHaveBeenCalled();
    expect(() => late()).not.toThrow();
  });
});

describe("AlleyProps", () => {
  it("puts the shop and graffiti on slab 0 and a dumpster and poster on the others", async () => {
    scene = await render3D(
      <>
        <group name="slab0">
          <AlleyProps index={0} high />
        </group>
        <group name="slab1">
          <AlleyProps index={1} high={false} />
        </group>
        <group name="slab2">
          <AlleyProps index={2} high={false} />
        </group>
      </>,
    );
    const props = (name: string) => scene?.find(name).children[0]?.children ?? [];
    // Two lamps, the shop, and a poster on slab 0.
    expect(props("slab0")).toHaveLength(4);
    expect(props("slab0")[0]?.position.toArray()).toEqual([-3.2, 0, -15]);
    expect(props("slab0")[1]?.position.toArray()).toEqual([3.2, 0, 11]);
    expect(props("slab0")[2]?.position.toArray()).toEqual([4.65, 0, 0]);
    expect(props("slab0")[3]?.position.toArray()).toEqual([-4.9, 1.2, 12]);
    // Two lamps, a dumpster, and a poster on the others.
    expect(props("slab1")).toHaveLength(4);
    expect(props("slab1")[2]?.position.toArray()).toEqual([-3.55, 0, 14]);
    expect(props("slab1")[3]?.position.toArray()).toEqual([4.9, 1.2, -8]);
    expect(props("slab2")[2]?.position.toArray()).toEqual([3.55, 0, -14]);
    expect(props("slab2")[3]?.position.toArray()).toEqual([-4.9, 1.35, 6]);

    expect(meshesUnder(scene.find("slab0")).some((mesh) => mesh.castShadow)).toBe(true);
    expect(meshesUnder(scene.find("slab1")).some((mesh) => mesh.castShadow)).toBe(false);
  });
});

describe("Street", () => {
  async function mountStreet(distance: number, quality: "high" | "low" = "low") {
    const controller = fakeController({}, { distance });
    scene = await render3D(<Street controller={controller} quality={quality} />);
    const slabs = scene.state().scene.children[1] as Object3D;
    return { controller, scene, slabs };
  }

  it("recycles three slabs so the board is always on the middle one", async () => {
    const { controller, scene: s, slabs } = await mountStreet(50);
    expect(slabs.children).toHaveLength(3);
    await s.frame();
    expect(slabs.children.map((slab) => slab.position.z)).toEqual([30, -10, -50].map((z) => expect.closeTo(z)));
    controller.frame.distance = 50 + SEGMENT_LENGTH;
    await s.frame();
    expect(slabs.children.map((slab) => slab.position.z)).toEqual([30, -10, -50].map((z) => expect.closeTo(z)));
    controller.frame.distance = 95;
    await s.frame();
    expect(slabs.children[0]?.position.z).toBeCloseTo(-(60 - 95));
  });

  it("keeps the right-hand building off slab 0 for the shop and gives every slab a scenery mount", async () => {
    const { slabs } = await mountStreet(0, "high");
    const directMeshes = (slab: Object3D | undefined) => slab?.children.filter((child) => child instanceof Mesh) ?? [];
    expect(directMeshes(slabs.children[0])).toHaveLength(2);
    expect(directMeshes(slabs.children[1])).toHaveLength(4);
    for (const slab of slabs.children) expect(slab.getObjectByName("park-scenery")).toBeDefined();
    expect((directMeshes(slabs.children[1])[0] as Mesh).receiveShadow).toBe(true);
  });

  it("copes with a missing slab and with a frame after unmount", async () => {
    const { scene: s, slabs } = await mountStreet(50);
    const last = slabs.children[2] as Object3D;
    last.removeFromParent();
    await s.frame();
    expect(slabs.children[1]?.position.z).toBeCloseTo(-10);
    expect(last.position.z).toBe(0);
    const late = s.captureFrame();
    await s.unmount();
    scene = null;
    expect(() => late()).not.toThrow();
  });
});

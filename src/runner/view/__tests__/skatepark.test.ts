import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3, type Object3D } from "three";
import { deferred, flush, slots, type Deferred } from "./art-slots-test-helpers";
// Build the artSlots mock now, bound to this file's `slots`. vi.resetModules
// keeps mocked modules, so later fresh imports still read these slots.
import "../../artSlots";
import { asRenderer, fakeRenderer } from "./r3f-test-helpers";

vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);

const loader = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../skateboardModel", async (importOriginal) => {
  return { ...(await importOriginal<typeof import("../skateboardModel")>()), loadRunnerModel: loader.fn };
});

type Skatepark = typeof import("../skatepark");

/** skatepark.ts keeps one shared load and a refcount, so each test gets a fresh copy. */
async function fresh(url: string | null = "park.glb"): Promise<Skatepark> {
  vi.resetModules();
  slots.skatepark = url;
  return import("../skatepark");
}

let loads: Array<Deferred<Object3D>>;

/**
 * A stand-in for the Sketchfab scene: every named node, each under a parent
 * that is offset and scaled the way the file nests them.
 */
function parkScene(names: readonly string[]): { scene: Group; geometry: BoxGeometry; texture: Texture } {
  const scene = new Group();
  const texture = new Texture();
  const geometry = new BoxGeometry(1, 0.5, 3);
  const material = new MeshStandardMaterial({ map: texture });
  for (const name of names) {
    const parent = new Group();
    parent.position.set(50, 3, -20);
    parent.scale.setScalar(2);
    const node = new Mesh(geometry, material);
    node.name = name;
    parent.add(node);
    scene.add(parent);
  }
  // Some Sketchfab meshes carry a material list; they are freed the same way.
  scene.add(new Mesh(new BoxGeometry(), [material, new MeshStandardMaterial()]));
  return { scene, geometry, texture };
}

/** One ObstaclePool slot with the waxed box fallback and an empty model mount. */
function boxSlot(withMount = true): Group {
  const group = new Group();
  const box = new Group();
  box.name = "box";
  for (const name of ["box-body", "box-wax", "box-coping"]) {
    const part = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    part.name = name;
    box.add(part);
  }
  if (withMount) {
    const mount = new Group();
    mount.name = "box-model";
    mount.visible = false;
    box.add(mount);
  }
  group.add(box);
  return group;
}

function fallback(slot: Object3D): boolean[] {
  return ["box-body", "box-wax", "box-coping"].map((name) => slot.getObjectByName(name)?.visible ?? false);
}

/** Street slabs, each with an optional sidewalk "park-scenery" group. */
function slabs(withScenery: boolean[]): Group {
  const root = new Group();
  for (const has of withScenery) {
    const slab = new Group();
    if (has) {
      const scenery = new Group();
      scenery.name = "park-scenery";
      slab.add(scenery);
    }
    root.add(slab);
  }
  return root;
}

async function resolveLoad(index: number, scene: Object3D): Promise<void> {
  await act(async () => {
    loads[index]?.resolve(scene);
    await flush();
  });
}

beforeEach(() => {
  loads = [];
  loader.fn.mockReset();
  loader.fn.mockImplementation(() => {
    const pending = deferred<Object3D>();
    loads.push(pending);
    return pending.promise;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSkateparkLedges", () => {
  it("does nothing with an empty slot", async () => {
    const park = await fresh(null);
    renderHook(() => park.useSkateparkLedges({ current: [boxSlot()] }, asRenderer(fakeRenderer())));
    expect(loader.fn).not.toHaveBeenCalled();
  });

  it("clones a ledge into each box slot by index, baked and fitted, and restores the box on leave", async () => {
    const park = await fresh();
    const gl = fakeRenderer(true);
    // Slot 13 wraps back to the first ledge name.
    const pool: Array<Group | null> = Array.from({ length: 14 }, () => boxSlot());
    pool[2] = null;
    pool[3] = boxSlot(false);
    const { unmount } = renderHook(() => park.useSkateparkLedges({ current: pool }, asRenderer(gl)));
    expect(loader.fn).toHaveBeenCalledWith("park.glb", gl);

    // The file is missing ledge #4, so slot 4 keeps its box.
    const names = park.LEDGE_NODE_NAMES.filter((_, i) => i !== 4);
    const { scene, geometry, texture } = parkScene(names);
    await resolveLoad(0, scene);
    expect(scene.name).toBe("SkateparkObstacles");

    const first = pool[0] as Group;
    const mount = first.getObjectByName("box-model") as Group;
    expect(mount.visible).toBe(true);
    expect(fallback(first)).toEqual([false, false, false]);
    const wrap = mount.children[0] as Group;
    const piece = wrap.children[0] as Mesh;
    expect(piece.name).toBe(park.LEDGE_NODE_NAMES[0]);
    expect(piece.castShadow && piece.receiveShadow).toBe(true);
    // The parent's ×2 scale is baked into the clone before the fit.
    expect(piece.scale.x).toBeCloseTo(2);
    wrap.updateMatrixWorld(true);
    const size = new Box3().setFromObject(wrap).getSize(new Vector3());
    expect(size.x).toBeLessThanOrEqual(1.25 + 1e-6);
    expect(size.y).toBeLessThanOrEqual(0.48 + 1e-6);

    expect((pool[1] as Group).getObjectByName(park.LEDGE_NODE_NAMES[1])).toBeDefined();
    expect((pool[13] as Group).getObjectByName(park.LEDGE_NODE_NAMES[0])).toBeDefined();
    expect(fallback(pool[3] as Group)).toEqual([true, true, true]);
    expect(fallback(pool[4] as Group)).toEqual([true, true, true]);

    const geometryDispose = vi.spyOn(geometry, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    unmount();
    expect(mount.children).toHaveLength(0);
    expect(mount.visible).toBe(false);
    expect(fallback(first)).toEqual([true, true, true]);
    // Last user out frees the shared source.
    expect(geometryDispose).toHaveBeenCalled();
    expect(textureDispose).toHaveBeenCalled();
  });

  it("skips shadows without a shadow map and copes with a mount that left its box", async () => {
    const park = await fresh();
    const slot = boxSlot();
    slot.getObjectByName("box-coping")?.removeFromParent();
    const { unmount } = renderHook(() => park.useSkateparkLedges({ current: [slot] }, asRenderer(fakeRenderer(false))));
    await resolveLoad(0, parkScene(park.LEDGE_NODE_NAMES).scene);
    const mount = slot.getObjectByName("box-model") as Group;
    const piece = mount.children[0]?.children[0] as Mesh;
    expect(piece.castShadow).toBe(false);
    mount.removeFromParent();
    expect(() => unmount()).not.toThrow();
    expect(mount.children).toHaveLength(0);
    expect(mount.visible).toBe(false);
  });

  it("ignores a load that lands after the slot left, and frees it", async () => {
    const park = await fresh();
    const slot = boxSlot();
    const { unmount } = renderHook(() => park.useSkateparkLedges({ current: [slot] }, asRenderer(fakeRenderer())));
    unmount();
    const { scene, geometry } = parkScene(park.LEDGE_NODE_NAMES);
    const dispose = vi.spyOn(geometry, "dispose");
    await resolveLoad(0, scene);
    expect(slot.getObjectByName("box-model")?.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalled();
  });

  it("warns, keeps the waxed box, and lets the next mount retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const park = await fresh();
    const slot = boxSlot();
    const first = renderHook(() => park.useSkateparkLedges({ current: [slot] }, asRenderer(fakeRenderer())));
    const error = new Error("glb 404");
    await act(async () => {
      loads[0]?.reject(error);
      await flush();
    });
    expect(warn).toHaveBeenCalledWith("Runner skatepark ledges failed to load", error);
    expect(fallback(slot)).toEqual([true, true, true]);
    first.unmount();

    renderHook(() => park.useSkateparkLedges({ current: [slot] }, asRenderer(fakeRenderer())));
    expect(loader.fn).toHaveBeenCalledTimes(2);
  });
});

describe("useSkateparkScenery", () => {
  it("does nothing with an empty slot or before the slabs mount", async () => {
    const empty = await fresh(null);
    renderHook(() => empty.useSkateparkScenery({ current: slabs([true]) }, asRenderer(fakeRenderer())));
    const park = await fresh();
    renderHook(() => park.useSkateparkScenery({ current: null }, asRenderer(fakeRenderer())));
    expect(loader.fn).not.toHaveBeenCalled();
  });

  it("parks two sidewalk pieces per slab, rotating through the scenery list", async () => {
    const park = await fresh();
    const root = slabs([true, false, true, true]);
    const { unmount } = renderHook(() => park.useSkateparkScenery({ current: root }, asRenderer(fakeRenderer(true))));
    // The file is missing the last kicker, so one spot on slab 3 stays empty.
    const names = park.SCENERY_NODE_NAMES.slice(0, 5);
    await resolveLoad(0, parkScene(names).scene);

    const spots = (index: number) => root.children[index]?.getObjectByName("park-scenery")?.children ?? [];
    const pieceName = (spot: Object3D | undefined) => spot?.children[0]?.children[0]?.name;
    expect(spots(0).map((spot) => spot.position.toArray())).toEqual([
      [-3.75, 0.06, -12],
      [3.75, 0.06, 8],
    ]);
    expect(spots(0).map(pieceName)).toEqual([park.SCENERY_NODE_NAMES[0], park.SCENERY_NODE_NAMES[1]]);
    expect(spots(2).map(pieceName)).toEqual([park.SCENERY_NODE_NAMES[4]]);
    expect(spots(3).map(pieceName)).toEqual([park.SCENERY_NODE_NAMES[0], park.SCENERY_NODE_NAMES[1]]);
    const piece = spots(0)[0]?.children[0]?.children[0] as Mesh;
    expect(piece.castShadow).toBe(true);
    const size = new Box3().setFromObject(spots(0)[0] as Object3D).getSize(new Vector3());
    expect(size.y).toBeLessThanOrEqual(1.65 + 1e-6);

    unmount();
    expect(spots(0)).toHaveLength(0);
    expect(spots(3)).toHaveLength(0);
  });

  it("ignores a load that lands after leave", async () => {
    const park = await fresh();
    const root = slabs([true]);
    const { unmount } = renderHook(() => park.useSkateparkScenery({ current: root }, asRenderer(fakeRenderer())));
    unmount();
    await resolveLoad(0, parkScene(park.SCENERY_NODE_NAMES).scene);
    expect(root.getObjectByName("park-scenery")?.children).toHaveLength(0);
  });

  it("warns with its own message when the load fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const park = await fresh();
    renderHook(() => park.useSkateparkScenery({ current: slabs([true]) }, asRenderer(fakeRenderer())));
    const error = new Error("glb 404");
    await act(async () => {
      loads[0]?.reject(error);
      await flush();
    });
    expect(warn).toHaveBeenCalledWith("Runner skatepark scenery failed to load", error);
  });
});

describe("shared skatepark load", () => {
  it("loads once for ledges and scenery and frees the source only when both leave", async () => {
    const park = await fresh();
    const gl = asRenderer(fakeRenderer());
    const ledges = renderHook(() => park.useSkateparkLedges({ current: [boxSlot()] }, gl));
    const scenery = renderHook(() => park.useSkateparkScenery({ current: slabs([true]) }, gl));
    expect(loader.fn).toHaveBeenCalledTimes(1);
    const { scene, geometry } = parkScene([...park.LEDGE_NODE_NAMES, ...park.SCENERY_NODE_NAMES]);
    const dispose = vi.spyOn(geometry, "dispose");
    await resolveLoad(0, scene);

    ledges.unmount();
    expect(dispose).not.toHaveBeenCalled();
    scenery.unmount();
    expect(dispose).toHaveBeenCalled();
  });

  it("frees a stale load when the street remounts before it lands", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const park = await fresh();
    const gl = asRenderer(fakeRenderer());
    const firstSlot = boxSlot();
    const first = renderHook(() => park.useSkateparkLedges({ current: [firstSlot] }, gl));
    first.unmount();
    const secondSlot = boxSlot();
    const second = renderHook(() => park.useSkateparkLedges({ current: [secondSlot] }, gl));
    expect(loader.fn).toHaveBeenCalledTimes(2);

    // The first (stale) load lands while the second mount is waiting: it is freed, not kept.
    const stale = parkScene(park.LEDGE_NODE_NAMES);
    const staleDispose = vi.spyOn(stale.geometry, "dispose");
    await resolveLoad(0, stale.scene);
    expect(staleDispose).toHaveBeenCalled();

    // A stale failure does not clear the live load either.
    second.unmount();
    renderHook(() => park.useSkateparkLedges({ current: [boxSlot()] }, gl));
    expect(loader.fn).toHaveBeenCalledTimes(3);
    await act(async () => {
      loads[1]?.reject(new Error("stale"));
      await flush();
    });
    expect(warn).toHaveBeenCalledWith("Runner skatepark ledges failed to load", expect.any(Error));
    renderHook(() => park.useSkateparkLedges({ current: [boxSlot()] }, gl));
    expect(loader.fn).toHaveBeenCalledTimes(3);
    const live = parkScene(park.LEDGE_NODE_NAMES);
    await resolveLoad(2, live.scene);
    expect(secondSlot.getObjectByName("box-model")?.children).toHaveLength(0);
  });
});

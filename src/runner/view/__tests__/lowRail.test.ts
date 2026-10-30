import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, type Object3D } from "three";
import { deferred, flush, resetSlots, slots, type Deferred } from "./art-slots-test-helpers";
import { asRenderer, fakeRenderer } from "./r3f-test-helpers";
import { RAIL_LENGTH } from "../../constants";
import { useLowRail } from "../lowRail";
import { loadRunnerModel } from "../skateboardModel";
import { expectWarned } from "./warn-test-helpers";

vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);
vi.mock("../skateboardModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../skateboardModel")>()),
  loadRunnerModel: vi.fn(),
}));

const load = vi.mocked(loadRunnerModel);
let pending: Deferred<Group>;

/** One ObstaclePool slot: a rail group with the box fallback and an empty model mount. */
function slot(withMount = true): Group {
  const group = new Group();
  const rail = new Group();
  rail.name = "rail";
  for (const name of ["rail-beam", "rail-post-near", "rail-post-far"]) {
    const part = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    part.name = name;
    rail.add(part);
  }
  if (withMount) {
    const mount = new Group();
    mount.name = "rail-model";
    mount.visible = false;
    rail.add(mount);
  }
  group.add(rail);
  return group;
}

/** A rail-shaped model: long on Z, with a textured standard material and a material array. */
function railModel(): { model: Group; texture: Texture; geometry: BoxGeometry; material: MeshStandardMaterial } {
  const model = new Group();
  const texture = new Texture();
  const geometry = new BoxGeometry(0.1, 0.4, 3, 1, 1, 4);
  const material = new MeshStandardMaterial({ map: texture });
  model.add(new Mesh(geometry, material));
  model.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), [new MeshStandardMaterial(), new MeshStandardMaterial()]));
  return { model, texture, geometry, material };
}

function fallbackVisible(group: Object3D): boolean[] {
  return ["rail-beam", "rail-post-near", "rail-post-far"].map((name) => group.getObjectByName(name)?.visible ?? false);
}

beforeEach(() => {
  resetSlots();
  pending = deferred<Group>();
  load.mockReset();
  load.mockReturnValue(pending.promise);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLowRail", () => {
  it("leaves the box rail alone when there is no model", () => {
    const slotsRef = { current: [slot()] };
    renderHook(() => useLowRail(slotsRef, asRenderer(fakeRenderer())));
    expect(load).not.toHaveBeenCalled();
    expect(fallbackVisible(slotsRef.current[0] as Group)).toEqual([true, true, true]);
  });

  it("fits one model to the rail length and clones it into every slot that has a mount", async () => {
    slots.lowRail = "rail.glb";
    const gl = fakeRenderer(true);
    const withMount = slot();
    const noMount = slot(false);
    const slotsRef = { current: [withMount, null, noMount] };
    const { unmount } = renderHook(() => useLowRail(slotsRef, asRenderer(gl)));
    expect(load).toHaveBeenCalledWith("rail.glb", gl);

    const { model, geometry, texture } = railModel();
    await act(async () => {
      pending.resolve(model);
      await flush();
    });

    expect(model.name).toBe("LowRail");
    const mount = withMount.getObjectByName("rail-model") as Group;
    expect(mount.visible).toBe(true);
    expect(mount.children).toHaveLength(1);
    const copy = mount.children[0] as Group;
    expect(copy).not.toBe(model);
    expect(copy.name).toBe("LowRail");
    // Fit to the sim's rail length: Z extent × scale.
    expect(3 * copy.scale.z).toBeCloseTo(RAIL_LENGTH, 4);
    const meshes: Mesh[] = [];
    copy.traverse((obj) => {
      if (obj instanceof Mesh) meshes.push(obj);
    });
    expect(meshes.every((mesh) => mesh.castShadow && mesh.receiveShadow)).toBe(true);
    expect(fallbackVisible(withMount)).toEqual([false, false, false]);
    // A slot with no model mount keeps its fallback.
    expect(fallbackVisible(noMount)).toEqual([true, true, true]);

    const geometryDispose = vi.spyOn(geometry, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    unmount();
    expect(mount.children).toHaveLength(0);
    expect(mount.visible).toBe(false);
    expect(fallbackVisible(withMount)).toEqual([true, true, true]);
    expect(geometryDispose).toHaveBeenCalled();
    expect(textureDispose).toHaveBeenCalled();
  });

  it("skips shadows when the renderer has no shadow map", async () => {
    slots.lowRail = "rail.glb";
    const withMount = slot();
    // An older pool slot with no far post: hide and show skip the missing part.
    withMount.getObjectByName("rail-post-far")?.removeFromParent();
    const { unmount } = renderHook(() => useLowRail({ current: [withMount] }, asRenderer(fakeRenderer(false))));
    await act(async () => {
      pending.resolve(railModel().model);
      await flush();
    });
    const copy = withMount.getObjectByName("rail-model")?.children[0];
    let shadowed = false;
    copy?.traverse((obj) => {
      if (obj instanceof Mesh && (obj.castShadow || obj.receiveShadow)) shadowed = true;
    });
    expect(copy).toBeDefined();
    expect(shadowed).toBe(false);
    expect(withMount.getObjectByName("rail-beam")?.visible).toBe(false);
    unmount();
    expect(withMount.getObjectByName("rail-beam")?.visible).toBe(true);
  });

  it("restores a mount that lost its copy and parent", async () => {
    slots.lowRail = "rail.glb";
    const withMount = slot();
    const { unmount } = renderHook(() => useLowRail({ current: [withMount] }, asRenderer(fakeRenderer())));
    await act(async () => {
      pending.resolve(railModel().model);
      await flush();
    });
    const mount = withMount.getObjectByName("rail-model") as Group;
    mount.clear();
    mount.removeFromParent();
    expect(() => unmount()).not.toThrow();
    expect(mount.visible).toBe(false);
  });

  it("disposes a model that lands after unmount", async () => {
    slots.lowRail = "rail.glb";
    const withMount = slot();
    const { unmount } = renderHook(() => useLowRail({ current: [withMount] }, asRenderer(fakeRenderer())));
    unmount();
    const { model, geometry, material } = railModel();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    await act(async () => {
      pending.resolve(model);
      await flush();
    });
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(withMount.getObjectByName("rail-model")?.children).toHaveLength(0);
  });

  it("warns and keeps the box rail when the load fails", async () => {
    slots.lowRail = "rail.glb";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const withMount = slot();
    renderHook(() => useLowRail({ current: [withMount] }, asRenderer(fakeRenderer())));
    const error = new Error("decoder");
    await act(async () => {
      pending.reject(error);
      await flush();
    });
    expectWarned(warn, ["low rail", "fail"], error.message);
    expect(fallbackVisible(withMount)).toEqual([true, true, true]);
  });
});

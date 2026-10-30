import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import { deferred, flush, resetSlots, slots, type Deferred } from "./art-slots-test-helpers";
import { useCustomBoardArt } from "../customArt";
import { expectWarned } from "./warn-test-helpers";

vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);

function deck(): { root: Group; graphic: Mesh; logo: Mesh } {
  const root = new Group();
  const graphic = new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ color: "#ff0000", emissive: "#330000" }));
  graphic.name = "Graphic";
  graphic.visible = false;
  const logo = new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ color: "#00ff00" }));
  logo.name = "LogoDecal";
  logo.visible = false;
  root.add(graphic, logo);
  return { root, graphic, logo };
}

let loads: Map<string, Deferred<Texture>>;
let loadSpy: MockInstance<TextureLoader["loadAsync"]>;

beforeEach(() => {
  resetSlots();
  loads = new Map();
  loadSpy = vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation((url: string) => {
    const pending = deferred<Texture>();
    loads.set(url, pending);
    return pending.promise as Promise<Texture<HTMLImageElement>>;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function settle(url: string, texture: Texture): Promise<void> {
  await act(async () => {
    loads.get(url)?.resolve(texture);
    await flush();
  });
}

describe("useCustomBoardArt", () => {
  it("fetches nothing when both slots are empty", () => {
    const { root } = deck();
    renderHook(() => useCustomBoardArt({ current: root }));
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("fetches nothing before the rig mounts", () => {
    slots.graphic = "graphic.webp";
    renderHook(() => useCustomBoardArt({ current: null }));
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("paints the deck graphic and logo as sRGB on a white base and shows them", async () => {
    slots.graphic = "graphic.webp";
    slots.logo = "logo.webp";
    const { root, graphic, logo } = deck();
    const { unmount } = renderHook(() => useCustomBoardArt({ current: root }));
    expect(loadSpy.mock.calls.map((call) => call[0])).toEqual(["graphic.webp", "logo.webp"]);

    const graphicTexture = new Texture();
    graphicTexture.colorSpace = NoColorSpace;
    const logoTexture = new Texture();
    await settle("graphic.webp", graphicTexture);
    await settle("logo.webp", logoTexture);

    const material = graphic.material as MeshStandardMaterial;
    expect(material.map).toBe(graphicTexture);
    expect(graphicTexture.colorSpace).toBe(SRGBColorSpace);
    expect(material.color.getHexString()).toBe("ffffff");
    expect(material.emissive.getHexString()).toBe("000000");
    expect(graphic.visible).toBe(true);
    expect((logo.material as MeshStandardMaterial).map).toBe(logoTexture);
    expect(logo.visible).toBe(true);

    const graphicDispose = vi.spyOn(graphicTexture, "dispose");
    const logoDispose = vi.spyOn(logoTexture, "dispose");
    unmount();
    expect(graphicDispose).toHaveBeenCalledTimes(1);
    expect(logoDispose).toHaveBeenCalledTimes(1);
  });

  it("only fetches the logo when the graphic slot is empty", () => {
    slots.logo = "logo.webp";
    const { root } = deck();
    renderHook(() => useCustomBoardArt({ current: root }));
    expect(loadSpy.mock.calls.map((call) => call[0])).toEqual(["logo.webp"]);
  });

  it("drops a texture whose mesh is missing or is not a standard material", async () => {
    slots.graphic = "graphic.webp";
    slots.logo = "logo.webp";
    const root = new Group();
    const basic = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
    basic.name = "Graphic";
    basic.visible = false;
    root.add(basic);
    renderHook(() => useCustomBoardArt({ current: root }));

    const onBasic = new Texture();
    const onMissing = new Texture();
    const basicDispose = vi.spyOn(onBasic, "dispose");
    const missingDispose = vi.spyOn(onMissing, "dispose");
    await settle("graphic.webp", onBasic);
    await settle("logo.webp", onMissing);

    expect(basicDispose).toHaveBeenCalledTimes(1);
    expect(missingDispose).toHaveBeenCalledTimes(1);
    expect((basic.material as MeshBasicMaterial).map).toBeNull();
    expect(basic.visible).toBe(false);
  });

  it("drops a texture that lands after unmount without touching the deck", async () => {
    slots.graphic = "graphic.webp";
    const { root, graphic } = deck();
    const { unmount } = renderHook(() => useCustomBoardArt({ current: root }));
    unmount();
    const late = new Texture();
    const dispose = vi.spyOn(late, "dispose");
    await settle("graphic.webp", late);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((graphic.material as MeshStandardMaterial).map).toBeNull();
    expect(graphic.visible).toBe(false);
  });

  it("warns and keeps the procedural deck when a load fails", async () => {
    slots.graphic = "graphic.webp";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { root, graphic } = deck();
    renderHook(() => useCustomBoardArt({ current: root }));
    const error = new Error("404");
    await act(async () => {
      loads.get("graphic.webp")?.reject(error);
      await flush();
    });
    expectWarned(warn, ["custom art", "fail"], error.message);
    expect(graphic.visible).toBe(false);
  });
});

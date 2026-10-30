import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { CanvasTexture, SRGBColorSpace, Texture, TextureLoader } from "three";
import { fakeContext2D, flush, stubCanvas2D, type FakeContext2D } from "./art-slots-test-helpers";

type BrandArt = typeof import("../brandArt");

/** brandArt memoizes its load and the shop sign, so each test gets a fresh copy. */
async function fresh(): Promise<BrandArt> {
  vi.resetModules();
  return import("../brandArt");
}

let fontsLoad: ReturnType<typeof vi.fn>;
let loadSpy: MockInstance<TextureLoader["loadAsync"]>;

function stubFonts(ready: Promise<unknown>): void {
  fontsLoad = vi.fn(() => Promise.resolve([]));
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready, load: fontsLoad } });
}

beforeEach(() => {
  stubFonts(Promise.resolve());
  loadSpy = vi.spyOn(TextureLoader.prototype, "loadAsync").mockImplementation(async (url: string) => {
    const texture = new Texture<HTMLImageElement>();
    texture.name = url;
    return texture;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fonts");
});

describe("brand art materials", () => {
  it("hands out one shared material per poster and one shop sign", async () => {
    const art = await fresh();
    expect(art.logoPosterMaterial()).toBe(art.logoPosterMaterial());
    expect(art.graffPosterMaterial()).not.toBe(art.logoPosterMaterial());
    expect(art.hubbaPosterMaterial()).not.toBe(art.graffPosterMaterial());
    const sign = art.shopSignMaterial();
    expect(art.shopSignMaterial()).toBe(sign);
    expect(sign.color.getHexString()).toBe("14382c");
    expect(sign.emissiveIntensity).toBeCloseTo(0.15);
    // Unpainted posters do not glow.
    expect(art.logoPosterMaterial().emissiveIntensity).toBe(0);
    expect(art.logoPosterMaterial().map).toBeNull();
  });
});

describe("ensureBrandArt", () => {
  it("paints each poster with its own glow and draws the shop sign in Bebas Neue", async () => {
    const ctx = fakeContext2D();
    stubCanvas2D(ctx);
    const art = await fresh();
    await art.ensureBrandArt();

    expect(loadSpy).toHaveBeenCalledTimes(3);
    const glow = [art.logoPosterMaterial(), art.graffPosterMaterial(), art.hubbaPosterMaterial()].map((m) => {
      expect(m.map).toBeInstanceOf(Texture);
      expect(m.emissiveMap).toBe(m.map);
      expect(m.map?.colorSpace).toBe(SRGBColorSpace);
      expect(m.map?.anisotropy).toBe(4);
      expect(m.color.getHexString()).toBe("ffffff");
      expect(m.emissive.getHexString()).toBe("ffffff");
      return m.emissiveIntensity;
    });
    expect(glow).toEqual([0.28, 0.12, 0.12]);
    expect(art.logoPosterMaterial().map?.name).toContain("board-logo");
    expect(art.graffPosterMaterial().map?.name).toContain("graff-wall");
    expect(art.hubbaPosterMaterial().map?.name).toContain("hubba-graff");

    expect(fontsLoad).toHaveBeenCalledWith("80px 'Bebas Neue'");
    const sign = art.shopSignMaterial();
    expect(sign.map).toBeInstanceOf(CanvasTexture);
    expect(sign.emissiveIntensity).toBeCloseTo(0.5);
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toEqual(["THE HUBBASPOT", "SKATESHOP"]);
    // The title shrinks from 84px until it fits 470px; the short line keeps 52px.
    expect(ctx.fontsAtFill).toEqual([60, 52]);
    expect(ctx.font).toContain('"Bebas Neue"');
  });

  it("loads once and returns the same promise after that", async () => {
    stubCanvas2D(fakeContext2D());
    const art = await fresh();
    const first = art.ensureBrandArt();
    expect(art.ensureBrandArt()).toBe(first);
    await first;
    expect(loadSpy).toHaveBeenCalledTimes(3);
  });

  it("stops shrinking the sign at 28px", async () => {
    const ctx: FakeContext2D = fakeContext2D();
    ctx.measureText = () => ({ width: 10_000 });
    stubCanvas2D(ctx);
    const art = await fresh();
    await art.ensureBrandArt();
    expect(ctx.fontsAtFill).toEqual([28, 28]);
  });

  it("still draws the sign when the web font fails, and skips it with no 2D canvas", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fontError = new Error("font blocked");
    const ready = Promise.reject(fontError);
    // Mark it handled until paintShopSign awaits it.
    ready.catch(() => undefined);
    stubFonts(ready);
    stubCanvas2D(null);
    const art = await fresh();
    await art.ensureBrandArt();
    expect(warn).toHaveBeenCalledWith("Runner sign font failed", fontError);
    expect(art.shopSignMaterial().map).toBeNull();
    // The posters still paint.
    expect(art.logoPosterMaterial().map).toBeInstanceOf(Texture);
  });

  it("lets a failed load be retried", async () => {
    stubCanvas2D(fakeContext2D());
    const art = await fresh();
    const error = new Error("offline");
    loadSpy.mockRejectedValueOnce(error);
    const failed = art.ensureBrandArt();
    await expect(failed).rejects.toBe(error);
    await flush();
    const retry = art.ensureBrandArt();
    expect(retry).not.toBe(failed);
    await retry;
    expect(art.logoPosterMaterial().map).toBeInstanceOf(Texture);
  });
});

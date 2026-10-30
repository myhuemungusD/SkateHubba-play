import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Texture,
} from "three";
import { fakeContext2D, flush, stubCanvas2D, type Deferred } from "./art-slots-test-helpers";
import { asRenderer, fakeRenderer } from "./r3f-test-helpers";

/** Every KTX2 / HDR load the module asks for, by asset file name. */
const ktx = vi.hoisted(() => ({
  fail: null as string | null,
  compressed: new Set<string>(),
  loaders: [] as Array<{ path: string; support: unknown; disposed: boolean; urls: string[] }>,
  hdr: [] as Array<{ resolve: (t: unknown) => void; reject: (e: unknown) => void }>,
  bakeHook: null as null | (() => void),
  pmrem: [] as Array<{ gl: unknown; disposed: boolean; baked: unknown }>,
}));

function fileName(url: string): string {
  return (url.split("/").pop() ?? url).replace(/\?.*$/, "").replace(/\.ktx2$/, "");
}

vi.mock("three/examples/jsm/loaders/KTX2Loader.js", async () => {
  const three = await import("three");
  class KTX2Loader {
    record = { path: "", support: null as unknown, disposed: false, urls: [] as string[] };
    constructor() {
      ktx.loaders.push(this.record);
    }
    setTranscoderPath(path: string) {
      this.record.path = path;
      return this;
    }
    detectSupport(gl: unknown) {
      this.record.support = gl;
      return this;
    }
    loadAsync(url: string) {
      const name = fileName(url);
      this.record.urls.push(name);
      if (ktx.fail === name) return Promise.reject(new Error(`bad ${name}`));
      const texture = ktx.compressed.has(name) ? new three.CompressedTexture([], 4, 4) : new three.Texture();
      texture.name = name;
      texture.generateMipmaps = false;
      texture.minFilter = three.LinearFilter;
      return Promise.resolve(texture);
    }
    dispose() {
      this.record.disposed = true;
    }
  }
  return { KTX2Loader };
});

vi.mock("three/examples/jsm/loaders/RGBELoader.js", () => ({
  RGBELoader: class {
    loadAsync() {
      return new Promise((resolve, reject) => {
        ktx.hdr.push({ resolve, reject });
      });
    }
  },
}));

vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof import("three")>();
  class PMREMGenerator {
    record = { gl: null as unknown, disposed: false, baked: null as unknown };
    constructor(gl: unknown) {
      this.record.gl = gl;
      ktx.pmrem.push(this.record);
    }
    fromEquirectangular(source: unknown) {
      ktx.bakeHook?.();
      const texture = new three.Texture();
      texture.userData.source = source;
      this.record.baked = texture;
      return { texture };
    }
    dispose() {
      this.record.disposed = true;
    }
  }
  return { ...three, PMREMGenerator };
});

const brand = vi.hoisted(() => ({ ensure: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("../brandArt", () => {
  brand.ensure = vi.fn(() => Promise.resolve());
  return { ensureBrandArt: brand.ensure };
});

type Textures = typeof import("../textures");
type Palette = typeof import("../palette");

/** textures.ts caches maps and materials per session, so each test gets a fresh copy. */
async function fresh(): Promise<{ tex: Textures; palette: Palette }> {
  vi.resetModules();
  const tex = await import("../textures");
  const palette = await import("../palette");
  return { tex, palette };
}

beforeEach(() => {
  ktx.fail = null;
  ktx.compressed.clear();
  ktx.loaders.length = 0;
  ktx.hdr.length = 0;
  ktx.pmrem.length = 0;
  ktx.bakeHook = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("material getters", () => {
  it("are session singletons with their street tuning", async () => {
    const { tex } = await fresh();
    expect(tex.roadMaterial()).toBe(tex.roadMaterial());
    expect(tex.roadMaterial().color.getHexString()).toBe("2e2c2a");
    expect(tex.sidewalkMaterial()).toBe(tex.sidewalkMaterial());
    expect(tex.sidewalkMaterial().roughness).toBeCloseTo(0.9);
    expect(tex.ledgeMaterial()).toBe(tex.ledgeMaterial());
    expect(tex.waxMaterial()).toBe(tex.waxMaterial());
    expect(tex.waxMaterial().metalness).toBeCloseTo(0.08);
    expect(tex.metalMaterial()).toBe(tex.metalMaterial());
    expect(tex.metalMaterial().metalness).toBe(1);
    expect(tex.brickMaterial()).toBe(tex.brickMaterial());
  });

  it("derives post, truck and building brick from their parents without sharing them", async () => {
    const { tex } = await fresh();
    const post = tex.postMaterial();
    expect(tex.postMaterial()).toBe(post);
    expect(post).not.toBe(tex.metalMaterial());
    expect(post.color.getHexString()).toBe("8e9599");
    expect(post.envMapIntensity).toBeCloseTo(0.65);
    expect(post.metalness).toBe(1);

    const truck = tex.truckMaterial();
    expect(tex.truckMaterial()).toBe(truck);
    expect(truck.envMapIntensity).toBeCloseTo(0.85);
    expect(truck.color.getHexString()).toBe(tex.metalMaterial().color.getHexString());

    const building = tex.brickBuildingMaterial();
    expect(tex.brickBuildingMaterial()).toBe(building);
    expect(building).not.toBe(tex.brickMaterial());
    expect(building.color.getHexString()).toBe("6e342c");
    expect(building.roughness).toBeCloseTo(tex.brickMaterial().roughness);
  });

  it("paints wood grain and grip tape when a 2D canvas exists", async () => {
    const ctx = fakeContext2D();
    stubCanvas2D(ctx);
    const { tex } = await fresh();
    const deck = tex.deckMaterial();
    expect(tex.deckMaterial()).toBe(deck);
    expect(deck.map).toBeInstanceOf(CanvasTexture);
    expect(deck.map?.wrapS).toBe(RepeatWrapping);
    expect(deck.map?.colorSpace).toBe(SRGBColorSpace);
    // Nine grain strokes across the 64px deck.
    expect(ctx.stroke).toHaveBeenCalledTimes(9);
    const grip = tex.gripMaterial();
    expect(tex.gripMaterial()).toBe(grip);
    expect(grip.map).toBeInstanceOf(CanvasTexture);
    // 280 grit specks plus the base fill (deck has 2 fills).
    expect(ctx.fillRect).toHaveBeenCalledTimes(2 + 1 + 280);
  });

  it("falls back to flat deck and grip colors without a 2D canvas", async () => {
    stubCanvas2D(null);
    const { tex } = await fresh();
    expect(tex.deckMaterial().map).toBeNull();
    expect(tex.deckMaterial().color.getHexString()).toBe("c4a06a");
    expect(tex.gripMaterial().map).toBeNull();
  });

  it("builds flat materials with no glow unless asked", async () => {
    const { tex } = await fresh();
    const plain = tex.flatMaterial("#123456");
    expect(plain.color.getHexString()).toBe("123456");
    expect(plain.emissive.getHexString()).toBe("000000");
    expect(tex.flatMaterial("#123456")).not.toBe(plain);
    expect(tex.flatMaterial("#000000", "#ffaa00").emissive.getHexString()).toBe("ffaa00");
  });
});

describe("ensureRunnerMaps", () => {
  it("loads the KTX2 sets once and tiles them onto the street materials", async () => {
    ktx.compressed.add("asphalt-color");
    const { tex, palette } = await fresh();
    const gl = asRenderer(fakeRenderer());
    const first = tex.ensureRunnerMaps(gl);
    expect(tex.ensureRunnerMaps(gl)).toBe(first);
    await first;

    expect(ktx.loaders).toHaveLength(1);
    const loader = ktx.loaders[0];
    expect(loader?.path).toBe("/runner/decoders/basis/");
    expect(loader?.support).toBe(gl);
    expect(loader?.disposed).toBe(true);
    expect(loader?.urls).toHaveLength(14);

    const road = tex.roadMaterial();
    expect(road.map?.repeat.toArray()).toEqual([3, 22]);
    expect(road.normalMap?.repeat.toArray()).toEqual([3, 22]);
    expect(road.roughnessMap?.name).toBe("asphalt-roughness");
    expect(road.color.getHexString()).toBe("c8c8c4");
    // Wet asphalt: roughness drops back below 1 after the map lands.
    expect(road.roughness).toBeCloseTo(0.5);
    expect(road.envMapIntensity).toBeCloseTo(0.5);
    expect(road.metalnessMap).toBeNull();

    // Compressed color keeps its own mips; the rest get trilinear mips.
    expect(road.map?.minFilter).toBe(LinearFilter);
    expect(road.map?.generateMipmaps).toBe(false);
    expect(road.map?.colorSpace).toBe(SRGBColorSpace);
    expect(road.normalMap?.minFilter).toBe(LinearMipmapLinearFilter);
    expect(road.normalMap?.generateMipmaps).toBe(true);
    expect(road.normalMap?.colorSpace).toBe(NoColorSpace);
    expect(road.normalMap?.anisotropy).toBe(4);

    const sidewalk = tex.sidewalkMaterial();
    expect(sidewalk.map?.repeat.toArray()).toEqual([2, 20]);
    expect(sidewalk.roughness).toBeCloseTo(0.82);
    expect(sidewalk.color.getHexString()).toBe("d5d0c8");

    // Ledge and wax share one tiled copy; wax keeps its own roughness and tint.
    const ledge = tex.ledgeMaterial();
    const wax = tex.waxMaterial();
    expect(wax.map).toBe(ledge.map);
    expect(ledge.map?.repeat.toArray()).toEqual([1, 2]);
    expect(ledge.roughness).toBe(1);
    expect(wax.roughnessMap).toBeNull();
    expect(wax.roughness).toBeCloseTo(0.32);
    expect(wax.color.getHexString()).toBe("f0e2c0");

    const metal = tex.metalMaterial();
    expect(metal.metalnessMap?.name).toBe("metal-metalness");
    expect(metal.map?.repeat.toArray()).toEqual([2, 6]);
    expect(tex.postMaterial().color.getHexString()).toBe("c5cbcf");
    expect(tex.postMaterial().map?.repeat.toArray()).toEqual([1, 1]);
    // Post and truck share the [1, 1] metal tiles.
    expect(tex.truckMaterial().map).toBe(tex.postMaterial().map);

    expect(tex.brickMaterial().map?.repeat.toArray()).toEqual([20, 1.1]);
    expect(tex.brickMaterial().color.getHexString()).toBe("c45c40");
    expect(tex.brickBuildingMaterial().map?.repeat.toArray()).toEqual([4, 1.15]);
    expect(tex.brickBuildingMaterial().color.getHexString()).toBe("8d4034");

    const atlas = palette.alleyPaletteMaterial().map;
    expect(atlas?.name).toBe("alley-palette");
    expect(atlas?.minFilter).toBe(NearestFilter);
    expect(atlas?.magFilter).toBe(NearestFilter);
    expect(atlas?.wrapS).toBe(ClampToEdgeWrapping);
    expect(atlas?.generateMipmaps).toBe(false);
  });

  it("disposes the loader on failure and lets the next call retry", async () => {
    ktx.fail = "brick-normal";
    const { tex } = await fresh();
    const gl = asRenderer(fakeRenderer());
    const failed = tex.ensureRunnerMaps(gl);
    await expect(failed).rejects.toThrow("bad brick-normal");
    expect(ktx.loaders[0]?.disposed).toBe(true);
    expect(tex.roadMaterial().map).toBeNull();

    ktx.fail = null;
    const retry = tex.ensureRunnerMaps(gl);
    expect(retry).not.toBe(failed);
    await retry;
    expect(ktx.loaders).toHaveLength(2);
    expect(tex.roadMaterial().map).toBeInstanceOf(Texture);
  });
});

describe("mountRunnerEnvironment", () => {
  async function mount(tex: Textures) {
    const gl = asRenderer(fakeRenderer());
    const scene = new Scene();
    const cleanup = tex.mountRunnerEnvironment(gl, scene);
    const hdr = new Texture();
    hdr.name = "hdri";
    return { gl, scene, cleanup, hdr, hdrLoad: ktx.hdr[0] as Deferred<Texture> };
  }

  it("bakes the HDRI into reflections only and clears it on leave", async () => {
    const { tex } = await fresh();
    const { gl, scene, cleanup, hdr, hdrLoad } = await mount(tex);
    expect(brand.ensure).toHaveBeenCalled();
    hdrLoad.resolve(hdr);
    await vi.waitFor(() => expect(scene.environment).not.toBeNull());

    const pmrem = ktx.pmrem[0];
    expect(pmrem?.gl).toBe(gl);
    expect(pmrem?.disposed).toBe(true);
    expect(scene.environment).toBe(pmrem?.baked);
    expect(scene.environment?.userData.source).toBe(hdr);
    expect(scene.background).toBeNull();

    const env = scene.environment as Texture;
    const envDispose = vi.spyOn(env, "dispose");
    const hdrDispose = vi.spyOn(hdr, "dispose");
    cleanup();
    expect(scene.environment).toBeNull();
    expect(envDispose).toHaveBeenCalled();
    expect(hdrDispose).toHaveBeenCalled();
  });

  it("leaves a newer environment in place on leave", async () => {
    const { tex } = await fresh();
    const { scene, cleanup, hdr, hdrLoad } = await mount(tex);
    hdrLoad.resolve(hdr);
    await vi.waitFor(() => expect(scene.environment).not.toBeNull());
    const other = new Texture();
    scene.environment = other;
    cleanup();
    expect(scene.environment).toBe(other);
  });

  it("throws away an HDRI that lands after leave without baking", async () => {
    const { tex } = await fresh();
    const { scene, cleanup, hdr, hdrLoad } = await mount(tex);
    const hdrDispose = vi.spyOn(hdr, "dispose");
    cleanup();
    hdrLoad.resolve(hdr);
    await vi.waitFor(() => expect(hdrDispose).toHaveBeenCalled());
    expect(ktx.pmrem).toHaveLength(0);
    expect(scene.environment).toBeNull();
  });

  it("throws away the bake if the view leaves while it runs", async () => {
    const { tex } = await fresh();
    const { scene, cleanup, hdr, hdrLoad } = await mount(tex);
    const hdrDispose = vi.spyOn(hdr, "dispose");
    // PMREM baking is synchronous; the guard covers a leave fired from inside it.
    ktx.bakeHook = cleanup;
    hdrLoad.resolve(hdr);
    await vi.waitFor(() => expect(hdrDispose).toHaveBeenCalled());
    const baked = ktx.pmrem[0]?.baked as Texture;
    expect(baked).toBeInstanceOf(Texture);
    expect(scene.environment).toBeNull();
  });

  it("keeps going when the brand art fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { tex } = await fresh();
    const error = new Error("poster 404");
    brand.ensure.mockReturnValueOnce(Promise.reject(error));
    const { scene, hdr, hdrLoad } = await mount(tex);
    hdrLoad.resolve(hdr);
    await vi.waitFor(() => expect(scene.environment).not.toBeNull());
    expect(warn).toHaveBeenCalledWith("Runner brand art failed to load", error);
  });

  it("warns and frees the HDRI when the street maps fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    ktx.fail = "concrete-color";
    const { tex } = await fresh();
    const { scene, hdr, hdrLoad } = await mount(tex);
    const hdrDispose = vi.spyOn(hdr, "dispose");
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("Runner environment failed to load", expect.any(Error)));
    hdrLoad.resolve(hdr);
    await vi.waitFor(() => expect(hdrDispose).toHaveBeenCalled());
    expect(scene.environment).toBeNull();
  });

  it("warns once when the HDRI itself fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { tex } = await fresh();
    const { scene, hdrLoad } = await mount(tex);
    const error = new Error("hdr 404");
    hdrLoad.reject(error);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("Runner environment failed to load", error));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(scene.environment).toBeNull();
  });
});

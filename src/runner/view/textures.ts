import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  type ColorSpace,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import alleyPaletteUrl from "../assets/alley-palette.ktx2?url";
import asphaltColorUrl from "../assets/asphalt-color.ktx2?url";
import asphaltNormalUrl from "../assets/asphalt-normal.ktx2?url";
import asphaltRoughnessUrl from "../assets/asphalt-roughness.ktx2?url";
import brickColorUrl from "../assets/brick-color.ktx2?url";
import brickNormalUrl from "../assets/brick-normal.ktx2?url";
import brickRoughnessUrl from "../assets/brick-roughness.ktx2?url";
import concreteColorUrl from "../assets/concrete-color.ktx2?url";
import concreteNormalUrl from "../assets/concrete-normal.ktx2?url";
import concreteRoughnessUrl from "../assets/concrete-roughness.ktx2?url";
import hdriUrl from "../assets/sunset_jhbcentral_1k.hdr?url";
import metalColorUrl from "../assets/metal-color.ktx2?url";
import metalMetalnessUrl from "../assets/metal-metalness.ktx2?url";
import metalNormalUrl from "../assets/metal-normal.ktx2?url";
import metalRoughnessUrl from "../assets/metal-roughness.ktx2?url";
import { ensureBrandArt } from "./brandArt";
import { assignAlleyPalette } from "./palette";

/**
 * CC0 PBR maps plus the Design Mainline posters for the runner only.
 * The tiling maps are KTX2 (UASTC for color and normals, ETC1S for the
 * data maps) and transcode to the GPU's compressed format. Sources are
 * listed in docs/RUNNER_ASSETS.md. Maps load after the lazy route mounts.
 */

const BASIS_TRANSCODER_PATH = "/runner/decoders/basis/";

interface MapSet {
  color: Texture;
  normal: Texture;
  roughness: Texture;
  metalness?: Texture;
}

const repeats = new Map<string, Texture>();

let asphalt: MapSet | null = null;
let concrete: MapSet | null = null;
let metalMaps: MapSet | null = null;
let brickMaps: MapSet | null = null;
let mapsPromise: Promise<void> | null = null;

let road: MeshStandardMaterial | null = null;
let sidewalk: MeshStandardMaterial | null = null;
let ledge: MeshStandardMaterial | null = null;
let wax: MeshStandardMaterial | null = null;
let metal: MeshStandardMaterial | null = null;
let post: MeshStandardMaterial | null = null;
let brick: MeshStandardMaterial | null = null;
let brickBuilding: MeshStandardMaterial | null = null;
let deck: MeshStandardMaterial | null = null;
let grip: MeshStandardMaterial | null = null;
let truck: MeshStandardMaterial | null = null;

function paintTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paint(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function woodGrain(): Texture | null {
  return paintTexture(64, 128, (ctx) => {
    ctx.fillStyle = "#c4a06a";
    ctx.fillRect(0, 0, 64, 128);
    ctx.strokeStyle = "rgba(92, 58, 28, 0.45)";
    ctx.lineWidth = 1;
    for (let x = 4; x < 64; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 3, 36, x - 2, 80, x + 1, 128);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 236, 210, 0.18)";
    ctx.fillRect(0, 0, 64, 3);
  });
}

function gripGrain(): Texture | null {
  return paintTexture(64, 64, (ctx) => {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(70,70,70,0.9)";
    for (let i = 0; i < 280; i += 1) {
      ctx.fillRect((i * 17) % 64, (i * 29) % 64, 1, 1);
    }
  });
}

function standard(color: string, roughness: number, metalness: number, envMapIntensity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness,
    metalness,
    envMapIntensity,
  });
}

function prepare(texture: Texture, colorSpace: ColorSpace): Texture {
  texture.colorSpace = colorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  const compressed = "isCompressedTexture" in texture && texture.isCompressedTexture === true;
  if (!compressed) {
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
  }
  texture.needsUpdate = true;
  return texture;
}

/** One texel per alley color. Mips would blend the cells, so this stays nearest. */
function preparePalette(texture: Texture): Texture {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function tiled(source: Texture, repeat: readonly [number, number]): Texture {
  const key = `${source.uuid}:${repeat[0]}:${repeat[1]}`;
  const cached = repeats.get(key);
  if (cached) return cached;
  const copy = source.clone();
  copy.repeat.set(repeat[0], repeat[1]);
  copy.needsUpdate = true;
  repeats.set(key, copy);
  return copy;
}

function assign(
  material: MeshStandardMaterial,
  maps: MapSet,
  repeat: readonly [number, number],
  rough: boolean,
  tint: string | null,
): void {
  material.map = tiled(maps.color, repeat);
  material.normalMap = tiled(maps.normal, repeat);
  if (rough) {
    material.roughnessMap = tiled(maps.roughness, repeat);
    material.roughness = 1;
  }
  if (maps.metalness) {
    material.metalnessMap = tiled(maps.metalness, repeat);
    material.metalness = 1;
  }
  if (tint) material.color.set(tint);
  material.needsUpdate = true;
}

function applyMaps(): void {
  if (asphalt) {
    // Roughness below 1 multiplies the map, so the same CC0 asphalt reads wet.
    assign(roadMaterial(), asphalt, [3, 22], true, "#c8c8c4");
    const roadMat = roadMaterial();
    roadMat.roughness = 0.5;
    roadMat.envMapIntensity = 0.5;
  }
  if (concrete) {
    assign(sidewalkMaterial(), concrete, [2, 20], true, "#d5d0c8");
    sidewalkMaterial().roughness = 0.82;
    assign(ledgeMaterial(), concrete, [1, 2], true, "#ffffff");
    assign(waxMaterial(), concrete, [1, 2], false, null);
  }
  if (metalMaps) {
    assign(metalMaterial(), metalMaps, [2, 6], true, "#ffffff");
    assign(postMaterial(), metalMaps, [1, 1], true, "#c5cbcf");
    assign(truckMaterial(), metalMaps, [1, 1], true, "#ffffff");
  }
  if (brickMaps) {
    // 40m backdrop, about 2m per tile. Warm red-brown over the pale source map.
    assign(brickMaterial(), brickMaps, [20, 1.1], true, "#c45c40");
    assign(brickBuildingMaterial(), brickMaps, [4, 1.15], true, "#8d4034");
  }
}

async function loadSet(
  loader: KTX2Loader,
  colorUrl: string,
  normalUrl: string,
  roughnessUrl: string,
  metalnessUrl?: string,
): Promise<MapSet> {
  const color = prepare(await loader.loadAsync(colorUrl), SRGBColorSpace);
  const normal = prepare(await loader.loadAsync(normalUrl), NoColorSpace);
  const roughness = prepare(await loader.loadAsync(roughnessUrl), NoColorSpace);
  const metalness = metalnessUrl ? prepare(await loader.loadAsync(metalnessUrl), NoColorSpace) : undefined;
  return { color, normal, roughness, metalness };
}

function loadMaps(gl: WebGLRenderer): Promise<void> {
  const loader = new KTX2Loader();
  loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
  loader.detectSupport(gl);
  return Promise.all([
    loadSet(loader, asphaltColorUrl, asphaltNormalUrl, asphaltRoughnessUrl),
    loadSet(loader, concreteColorUrl, concreteNormalUrl, concreteRoughnessUrl),
    loadSet(loader, metalColorUrl, metalNormalUrl, metalRoughnessUrl, metalMetalnessUrl),
    loadSet(loader, brickColorUrl, brickNormalUrl, brickRoughnessUrl),
    loader.loadAsync(alleyPaletteUrl).then((texture) => preparePalette(texture)),
  ])
    .then(([nextAsphalt, nextConcrete, nextMetal, nextBrick, palette]) => {
      asphalt = nextAsphalt;
      concrete = nextConcrete;
      metalMaps = nextMetal;
      brickMaps = nextBrick;
      applyMaps();
      assignAlleyPalette(palette);
    })
    .finally(() => {
      loader.dispose();
    });
}

export function ensureRunnerMaps(gl: WebGLRenderer): Promise<void> {
  mapsPromise ??= loadMaps(gl).catch((error: unknown) => {
    mapsPromise = null;
    throw error;
  });
  return mapsPromise;
}

/**
 * Image maps stay cached for the session. The HDRI is decoded per visit
 * and thrown away on leave, and it lights reflections only — the background
 * stays the street fog color.
 */
export function mountRunnerEnvironment(gl: WebGLRenderer, scene: Scene): () => void {
  let disposed = false;
  let env: Texture | null = null;
  let hdr: Texture | null = null;

  void (async () => {
    const hdrPromise = new RGBELoader().loadAsync(hdriUrl);
    try {
      const brandPromise = ensureBrandArt().catch((error: unknown) => {
        console.warn("Runner brand art failed to load", error);
      });
      await Promise.all([hdrPromise, ensureRunnerMaps(gl), brandPromise]);
      const loaded = await hdrPromise;
      if (disposed) {
        loaded.dispose();
        return;
      }
      const pmrem = new PMREMGenerator(gl);
      const baked = pmrem.fromEquirectangular(loaded);
      pmrem.dispose();
      if (disposed) {
        baked.texture.dispose();
        loaded.dispose();
        return;
      }
      hdr = loaded;
      env = baked.texture;
      scene.environment = env;
    } catch (error: unknown) {
      console.warn("Runner environment failed to load", error);
      void hdrPromise.then((texture) => texture.dispose()).catch(() => undefined);
    }
  })();

  return () => {
    disposed = true;
    if (scene.environment === env) scene.environment = null;
    env?.dispose();
    hdr?.dispose();
  };
}

export function roadMaterial(): MeshStandardMaterial {
  road ??= standard("#2e2c2a", 0.5, 0, 0.5);
  return road;
}

export function sidewalkMaterial(): MeshStandardMaterial {
  sidewalk ??= standard("#b8b8b8", 0.9, 0, 0.28);
  return sidewalk;
}

export function ledgeMaterial(): MeshStandardMaterial {
  ledge ??= standard("#b8b8b8", 0.9, 0, 0.3);
  return ledge;
}

export function waxMaterial(): MeshStandardMaterial {
  wax ??= standard("#f0e2c0", 0.32, 0.08, 0.62);
  return wax;
}

export function metalMaterial(): MeshStandardMaterial {
  metal ??= standard("#b0b3b4", 0.45, 1, 0.9);
  return metal;
}

export function postMaterial(): MeshStandardMaterial {
  if (!post) {
    post = metalMaterial().clone();
    post.color.set("#8e9599");
    post.envMapIntensity = 0.65;
  }
  return post;
}

export function brickMaterial(): MeshStandardMaterial {
  brick ??= standard("#8a4034", 0.92, 0, 0.12);
  return brick;
}

export function brickBuildingMaterial(): MeshStandardMaterial {
  if (!brickBuilding) {
    brickBuilding = brickMaterial().clone();
    brickBuilding.color.set("#6e342c");
  }
  return brickBuilding;
}

export function deckMaterial(): MeshStandardMaterial {
  if (!deck) {
    deck = standard("#c4a06a", 0.72, 0, 0.12);
    deck.map = woodGrain() ?? null;
  }
  return deck;
}

export function gripMaterial(): MeshStandardMaterial {
  if (!grip) {
    grip = standard("#141414", 0.96, 0, 0.05);
    grip.map = gripGrain() ?? null;
  }
  return grip;
}

export function truckMaterial(): MeshStandardMaterial {
  if (!truck) {
    truck = metalMaterial().clone();
    truck.envMapIntensity = 0.85;
  }
  return truck;
}

export function flatMaterial(color: string, emissive?: string): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: emissive ?? "#000000",
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.12,
  });
}

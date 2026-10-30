/**
 * 360 shoe skins for the Mike White Signature collection.
 *
 * Each skin is Mike's side-view art (cut out, cropped, bled past the edge) as
 * a 1024x512 texture plus the silhouette profile it was cut from. The viewer
 * lofts a low-poly shoe from that profile, so the art lines up with the mesh
 * exactly and every design shares one look. Built by
 * scripts/closet/build_shoe_skins.py; add a slug there and rerun to drop in
 * another design. No skin → the 2D card is shown instead.
 */
import skins from "./shoe360Skins.json";

export interface ShoeProfile {
  /** Silhouette height / length. */
  aspect: number;
  /** Per column (heel → toe), top and bottom edge as a fraction of height. */
  top: number[];
  bottom: number[];
}

export type ShoeView = "outer" | "inner" | "top" | "front" | "back";

/** Atlas regions (pixels, top-left origin) in a 2048x1024 multi-view skin. */
const ATLAS_SIZE = { w: 2048, h: 1024 } as const;
export const ATLAS_REGIONS: Record<ShoeView, readonly [number, number, number, number]> = {
  outer: [0, 0, 1024, 512],
  top: [1024, 0, 2048, 512],
  inner: [0, 512, 1024, 1024],
  front: [1024, 512, 1536, 1024],
  back: [1536, 512, 2048, 1024],
};

interface ShoeSkinEntry extends ShoeProfile {
  /** Views packed in the atlas (multi-view skins only). */
  views?: ShoeView[];
  /** Views the art is still missing; those faces fall back to the side art. */
  needs?: ShoeView[];
}

export interface ShoeSkin {
  itemDefId: string;
  textureUrl: string;
  profile: ShoeProfile;
  /** Present for multi-view atlas skins; absent for single side-view skins. */
  views?: ShoeView[];
  needs?: ShoeView[];
}

const SKINS = skins as Record<string, ShoeSkinEntry>;

function slugFor(itemDefId: string): string {
  return itemDefId.replace(/^mike_white_/, "").replace(/_/g, "-");
}

/** The polished 2D card for a Mike White design (consistent backdrop, crop, shadow). */
export function cardArtFor(itemDefId: string): string {
  return `/assets/closet/mike-white/card/${slugFor(itemDefId)}.webp`;
}

export function shoeSkinFor(itemDefId: string | null | undefined): ShoeSkin | null {
  if (!itemDefId) return null;
  const entry = SKINS[itemDefId];
  if (!entry) return null;
  const { views, needs, ...profile } = entry;
  const skin: ShoeSkin = {
    itemDefId,
    textureUrl: `/assets/closet/mike-white/skin/${slugFor(itemDefId)}.webp`,
    profile,
  };
  if (views) {
    skin.views = views;
    skin.needs = needs ?? [];
  }
  return skin;
}

export function skinnedItemIds(): string[] {
  return Object.keys(SKINS);
}

export interface LoftGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  /** Length is 1 (x from -0.5 heel to 0.5 toe); height is `aspect`. */
  height: number;
}

/** Plan-view half width at x in [0,1]: narrow heel, wide forefoot, rounded ends. */
export function halfWidth(x: number): number {
  const t = Math.min(1, Math.max(0, (x - 0.15) / 0.5));
  const smooth = t * t * (3 - 2 * t);
  const round = Math.pow(Math.max(0, Math.sin(Math.PI * x)), 0.35);
  return 0.17 * (0.74 + 0.26 * smooth) * round;
}

/** Signed power keeps the section boxy like a shoe instead of a tube. */
function spow(v: number, p: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), p);
}

/**
 * Loft the shoe: one ring per profile column (plus closed heel/toe rings).
 * UVs project the side art straight on, so both sides show the design the
 * right way round. The seam sits under the sole where nobody looks.
 */
export function buildShoeLoft(profile: ShoeProfile, segments = 20): LoftGeometry {
  const cols = profile.top.length;
  const h = profile.aspect;
  const xs = [0, ...profile.top.map((_, i) => (i + 0.5) / cols), 1];
  const at = (arr: number[], r: number) => arr[Math.min(cols - 1, Math.max(0, r - 1))];
  const rings = xs.length;
  const ring = segments + 1;
  const positions = new Float32Array(rings * ring * 3);
  const uvs = new Float32Array(rings * ring * 2);
  for (let r = 0; r < rings; r++) {
    const x = xs[r];
    const bottom = at(profile.bottom, r);
    const edge = r === 0 || r === rings - 1;
    // Heel and toe caps drop to half height so the ends round off instead of a flat wall.
    const rawTop = Math.max(at(profile.top, r), bottom + 0.02);
    const top = edge ? bottom + (rawTop - bottom) * 0.5 : rawTop;
    const hw = halfWidth(x);
    for (let s = 0; s < ring; s++) {
      const phi = -Math.PI / 2 + (s / segments) * Math.PI * 2;
      const sin = Math.sin(phi);
      const yn = 0.5 + 0.5 * spow(sin, sin < 0 ? 0.25 : 0.6);
      const y = (bottom + (top - bottom) * yn) * h;
      const z = hw * spow(Math.cos(phi), 0.5) * (1 - 0.25 * Math.max(0, sin));
      const k = r * ring + s;
      positions[k * 3] = x - 0.5;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      uvs[k * 2] = x;
      uvs[k * 2 + 1] = y / h;
    }
  }
  const indices = new Uint16Array((rings - 1) * segments * 6);
  let i = 0;
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * ring + s;
      const b = a + ring;
      indices.set([a, b, a + 1, b, b + 1, a + 1], i);
      i += 6;
    }
  }
  return { positions, uvs, indices, height: h };
}

const MAX_HALF_WIDTH = 0.17;

/** Map a local (u, v) in [0,1] (v up) inside an atlas region to texture UVs. */
function atlasUv(view: ShoeView, u: number, v: number): [number, number] {
  const [x0, y0, x1, y1] = ATLAS_REGIONS[view];
  const px = x0 + Math.min(1, Math.max(0, u)) * (x1 - x0);
  const py = y0 + (1 - Math.min(1, Math.max(0, v))) * (y1 - y0);
  return [px / ATLAS_SIZE.w, 1 - py / ATLAS_SIZE.h];
}

/** Which view a face shows, from its outward normal; missing views fall back to a side. */
export function viewForNormal(n: readonly [number, number, number], have: ReadonlySet<ShoeView>): ShoeView {
  const side: ShoeView = n[2] >= 0 ? (have.has("inner") ? "inner" : "outer") : have.has("outer") ? "outer" : "inner";
  if (Math.abs(n[0]) > 0.72) {
    const end: ShoeView = n[0] > 0 ? "front" : "back";
    return have.has(end) ? end : side;
  }
  if (n[1] > 0.62 && have.has("top")) return "top";
  return side;
}

/**
 * Multi-view loft: same mesh as buildShoeLoft, unshared per triangle so each
 * face can take the view it points at (inner on +z, outer on -z, top, toe, heel).
 * Side art is stored toe-right, so both sides project with u = x.
 */
export function buildMultiViewLoft(profile: ShoeProfile, views: readonly ShoeView[], segments = 20): LoftGeometry {
  const base = buildShoeLoft(profile, segments);
  const have = new Set(views);
  const h = base.height;
  const tris = base.indices.length / 3;
  const positions = new Float32Array(tris * 9);
  const uvs = new Float32Array(tris * 6);
  const p = (i: number): [number, number, number] => [
    base.positions[i * 3],
    base.positions[i * 3 + 1],
    base.positions[i * 3 + 2],
  ];
  for (let t = 0; t < tris; t++) {
    const ids = [base.indices[t * 3], base.indices[t * 3 + 1], base.indices[t * 3 + 2]];
    const [a, b, c] = ids.map(p);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: [number, number, number] = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const out = [cen[0] * 0.6, cen[1] - h * 0.45, cen[2]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const view = viewForNormal([n[0] / len, n[1] / len, n[2] / len], have);
    [a, b, c].forEach((v, k) => {
      const o = t * 3 + k;
      positions.set(v, o * 3);
      const x = v[0] + 0.5;
      const y = v[1] / h;
      const zn = v[2] / (2 * MAX_HALF_WIDTH);
      let uv: [number, number];
      if (view === "top") uv = atlasUv("top", x, 0.5 + zn);
      else if (view === "front") uv = atlasUv("front", 0.5 - zn, y);
      else if (view === "back") uv = atlasUv("back", 0.5 + zn, y);
      else uv = atlasUv(view, x, y);
      uvs.set(uv, o * 2);
    });
  }
  const indices = new Uint16Array(tris * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, uvs, indices, height: h };
}

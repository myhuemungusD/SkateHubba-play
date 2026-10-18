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

export interface ShoeSkin {
  itemDefId: string;
  textureUrl: string;
  profile: ShoeProfile;
}

const SKINS = skins as Record<string, ShoeProfile>;

function slugFor(itemDefId: string): string {
  return itemDefId.replace(/^mike_white_/, "").replace(/_/g, "-");
}

/** The polished 2D card for a Mike White design (consistent backdrop, crop, shadow). */
export function cardArtFor(itemDefId: string): string {
  return `/assets/closet/mike-white/card/${slugFor(itemDefId)}.webp`;
}

export function shoeSkinFor(itemDefId: string | null | undefined): ShoeSkin | null {
  if (!itemDefId) return null;
  const profile = SKINS[itemDefId];
  if (!profile) return null;
  return { itemDefId, textureUrl: `/assets/closet/mike-white/skin/${slugFor(itemDefId)}.webp`, profile };
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

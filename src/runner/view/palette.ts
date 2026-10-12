import { BoxGeometry, BufferGeometry, CylinderGeometry, MeshStandardMaterial, type Texture } from "three";

/** Cells across alley-palette.ktx2. One material, UVs pinned to a cell. */
export const PALETTE_CELLS = 8;

export const PALETTE = {
  pole: 0,
  awning: 1,
  stripe: 2,
  dumpster: 3,
  lid: 4,
} as const;

const geometries = new Map<string, BufferGeometry>();
let material: MeshStandardMaterial | null = null;

function pinUvs(geometry: BufferGeometry, cell: number): BufferGeometry {
  const uv = geometry.getAttribute("uv");
  const u = (cell + 0.5) / PALETTE_CELLS;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, u, 0.5);
  uv.needsUpdate = true;
  return geometry;
}

function cached(key: string, create: () => BufferGeometry): BufferGeometry {
  const found = geometries.get(key);
  if (found) return found;
  const geometry = create();
  geometries.set(key, geometry);
  return geometry;
}

export function alleyPaletteMaterial(): MeshStandardMaterial {
  material ??= new MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.78,
    metalness: 0.04,
  });
  return material;
}

export function assignAlleyPalette(map: Texture): void {
  const next = alleyPaletteMaterial();
  next.map = map;
  next.needsUpdate = true;
}

export function paletteBox(width: number, height: number, depth: number, cell: number): BufferGeometry {
  return cached(`box:${width}x${height}x${depth}@${cell}`, () => pinUvs(new BoxGeometry(width, height, depth), cell));
}

export function paletteCylinder(radiusTop: number, radiusBottom: number, height: number, cell: number): BufferGeometry {
  return cached(`cyl:${radiusTop}x${radiusBottom}x${height}@${cell}`, () =>
    pinUvs(new CylinderGeometry(radiusTop, radiusBottom, height, 6), cell),
  );
}

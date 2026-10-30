import { describe, expect, it } from "vitest";
import { Texture } from "three";
import { PALETTE, alleyPaletteMaterial, assignAlleyPalette, paletteBox, paletteCylinder } from "../palette";

/** alley-palette.ktx2 is eight cells across. */
const PALETTE_CELLS = 8;

function uvs(geometry: ReturnType<typeof paletteBox>): Array<[number, number]> {
  const uv = geometry.getAttribute("uv");
  return Array.from({ length: uv.count }, (_, i) => [uv.getX(i), uv.getY(i)]);
}

describe("alley palette", () => {
  it("shares one material and paints the atlas onto it", () => {
    const material = alleyPaletteMaterial();
    expect(alleyPaletteMaterial()).toBe(material);
    expect(material.roughness).toBeCloseTo(0.78);
    expect(material.metalness).toBeCloseTo(0.04);
    expect(material.map).toBeNull();

    const before = material.version;
    const atlas = new Texture();
    assignAlleyPalette(atlas);
    expect(material.map).toBe(atlas);
    expect(material.version).toBeGreaterThan(before);
  });

  it("pins every box UV to the middle of its palette cell", () => {
    const box = paletteBox(0.9, 0.84, 1.25, PALETTE.dumpster);
    const u = (PALETTE.dumpster + 0.5) / PALETTE_CELLS;
    const all = uvs(box);
    expect(all.length).toBeGreaterThan(0);
    for (const [x, y] of all) {
      expect(x).toBeCloseTo(u);
      expect(y).toBeCloseTo(0.5);
    }
  });

  it("reuses a geometry for the same size and cell, and not across cells", () => {
    const lid = paletteBox(0.94, 0.08, 1.15, PALETTE.lid);
    expect(paletteBox(0.94, 0.08, 1.15, PALETTE.lid)).toBe(lid);
    expect(paletteBox(0.94, 0.08, 1.15, PALETTE.awning)).not.toBe(lid);
    expect(paletteBox(0.95, 0.08, 1.15, PALETTE.lid)).not.toBe(lid);
  });

  it("builds a six-sided pole pinned to its cell and caches it apart from boxes", () => {
    const pole = paletteCylinder(0.045, 0.06, 3.1, PALETTE.pole);
    expect(pole.type).toBe("CylinderGeometry");
    expect((pole as unknown as { parameters: { radialSegments: number } }).parameters.radialSegments).toBe(6);
    expect(paletteCylinder(0.045, 0.06, 3.1, PALETTE.pole)).toBe(pole);
    const u = (PALETTE.pole + 0.5) / PALETTE_CELLS;
    for (const [x] of uvs(pole)) expect(x).toBeCloseTo(u);
  });
});

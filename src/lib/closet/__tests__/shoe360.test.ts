import { describe, expect, it } from "vitest";
import { buildShoeLoft, cardArtFor, halfWidth, shoeSkinFor, skinnedItemIds } from "../shoe360";
import { MIKE_WHITE_COLLECTION } from "../mikeWhiteCollection";

describe("shoe360 skins", () => {
  it("ships the 8 launch skins, all real collection items", () => {
    const ids = new Set(MIKE_WHITE_COLLECTION.map((i) => i.itemDefId));
    expect(skinnedItemIds()).toHaveLength(8);
    for (const id of skinnedItemIds()) expect(ids.has(id)).toBe(true);
  });

  it("resolves a skin's texture and profile", () => {
    const skin = shoeSkinFor("mike_white_m_navy_gold");
    expect(skin?.textureUrl).toBe("/assets/closet/mike-white/skin/m-navy-gold.webp");
    expect(skin?.profile.top.length).toBe(skin?.profile.bottom.length);
  });

  it("returns null for unskinned or missing ids", () => {
    expect(shoeSkinFor("mike_white_dip_sets")).toBeNull();
    expect(shoeSkinFor(null)).toBeNull();
    expect(shoeSkinFor(undefined)).toBeNull();
  });

  it("points every design at its polished card", () => {
    expect(cardArtFor("mike_white_signature_001")).toBe("/assets/closet/mike-white/card/signature-001.webp");
    for (const item of MIKE_WHITE_COLLECTION) expect(item.artUrl).toBe(cardArtFor(item.itemDefId));
  });
});

describe("buildShoeLoft", () => {
  it("closes the heel and toe and widens toward the forefoot", () => {
    expect(halfWidth(0)).toBe(0);
    expect(halfWidth(1)).toBeCloseTo(0, 5);
    expect(halfWidth(0.7)).toBeGreaterThan(halfWidth(0.15));
  });

  it("builds a low-poly ring mesh with side-projected UVs", () => {
    const profile = { aspect: 0.5, top: [0.4, 0.9, 1, 0.7], bottom: [0.1, 0, 0, 0.6] };
    const g = buildShoeLoft(profile, 8);
    const rings = profile.top.length + 2;
    expect(g.positions.length).toBe(rings * 9 * 3);
    expect(g.uvs.length).toBe(rings * 9 * 2);
    expect(g.indices.length).toBe((rings - 1) * 8 * 6);
    expect(g.height).toBe(0.5);
    for (let i = 0; i < g.uvs.length; i++) {
      expect(g.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(g.uvs[i]).toBeLessThanOrEqual(1.0001);
    }
    // Column 3's top (0.7) sits barely above its bottom (0.6): never inverted.
    const ys = Array.from({ length: 9 }, (_, s) => g.positions[(4 * 9 + s) * 3 + 1]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.6 * 0.5 - 1e-6);
  });
});

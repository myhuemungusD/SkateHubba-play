import { describe, expect, it } from "vitest";
import {
  ATLAS_REGIONS,
  buildMultiViewLoft,
  buildShoeLoft,
  cardArtFor,
  halfWidth,
  shoeSkinFor,
  skinnedItemIds,
  viewForNormal,
  type ShoeView,
} from "../shoe360";
import { designerCreditFor } from "../mikeWhiteCollection";
import { MIKE_WHITE_COLLECTION } from "../mikeWhiteCollection";

describe("shoe360 skins", () => {
  it("ships the 8 launch skins plus 4 multi-view skins, all real collection items", () => {
    const ids = new Set(MIKE_WHITE_COLLECTION.map((i) => i.itemDefId));
    expect(skinnedItemIds()).toHaveLength(12);
    for (const id of skinnedItemIds()) expect(ids.has(id)).toBe(true);
  });

  it("resolves a skin's texture and profile", () => {
    const skin = shoeSkinFor("mike_white_m_navy_gold");
    expect(skin?.textureUrl).toBe("/assets/closet/mike-white/skin/m-navy-gold.webp");
    expect(skin?.profile.top.length).toBe(skin?.profile.bottom.length);
  });

  it("returns null for unskinned or missing ids", () => {
    expect(shoeSkinFor("mike_white_og_gum")).toBeNull();
    expect(shoeSkinFor("mike_white_claw_runner_royal")).toBeNull();
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

describe("multi-view skins", () => {
  it("Heel Loop Low is a full 5-view 360 credited to Mike White", () => {
    const skin = shoeSkinFor("mike_white_heel_loop_white_red");
    expect(skin?.views).toEqual(["outer", "inner", "top", "front", "back"]);
    expect(skin?.needs).toEqual([]);
    expect(skin?.textureUrl).toBe("/assets/closet/mike-white/skin/heel-loop-white-red.webp");
    expect(designerCreditFor("mike_white_heel_loop_white_red")?.credit).toBe("Designed by Mike White");
    expect(designerCreditFor("mike_white_heel_loop_white_red")?.collectionName).toBe("Mike White Signature");
  });

  it("Claw Runner is a full 5-view 360 credited to Mike White", () => {
    const skin = shoeSkinFor("mike_white_claw_runner");
    expect(skin?.views).toEqual(["outer", "inner", "top", "front", "back"]);
    expect(skin?.needs).toEqual([]);
    expect(designerCreditFor("mike_white_claw_runner")?.designer).toBe("Mike White");
  });

  it("MW Patch Brown gets a full 5-view 360 from its labeled sheet", () => {
    expect(shoeSkinFor("mike_white_mw_patch_brown")?.views).toHaveLength(5);
    expect(shoeSkinFor("mike_white_mw_patch_brown")?.needs).toEqual([]);
  });

  it("Dip Sets gets a full 5-view 360 from its labeled sheet", () => {
    const skin = shoeSkinFor("mike_white_dip_sets");
    expect(skin?.views).toEqual(["outer", "inner", "top", "front", "back"]);
    expect(skin?.needs).toEqual([]);
  });

  it("single-view skins carry no views", () => {
    expect(shoeSkinFor("mike_white_m_navy_gold")?.views).toBeUndefined();
  });

  it("picks the view a face points at and falls back when missing", () => {
    const all = new Set<ShoeView>(["outer", "inner", "top", "front", "back"]);
    expect(viewForNormal([0, 0, 1], all)).toBe("inner");
    expect(viewForNormal([0, 0, -1], all)).toBe("outer");
    expect(viewForNormal([0, 1, 0], all)).toBe("top");
    expect(viewForNormal([1, 0, 0], all)).toBe("front");
    expect(viewForNormal([-1, 0, 0], all)).toBe("back");
    const three = new Set<ShoeView>(["outer", "front", "back"]);
    expect(viewForNormal([0, 0, 1], three)).toBe("outer");
    expect(viewForNormal([0, 1, 0.1], three)).toBe("outer");
    const innerOnly = new Set<ShoeView>(["inner"]);
    expect(viewForNormal([0, 0, -1], innerOnly)).toBe("inner");
    expect(viewForNormal([1, 0, 0], innerOnly)).toBe("inner");
  });

  it("builds an unshared mesh with every UV inside the atlas", () => {
    const profile = { aspect: 0.5, top: [0.4, 0.9, 1, 0.7], bottom: [0.1, 0, 0, 0.6] };
    const g = buildMultiViewLoft(profile, ["outer", "inner", "top", "front", "back"], 8);
    const tris = (profile.top.length + 1) * 8 * 2;
    expect(g.indices.length).toBe(tris * 3);
    expect(g.positions.length).toBe(tris * 9);
    expect(g.indices[5]).toBe(5);
    for (let i = 0; i < g.uvs.length; i++) {
      expect(g.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(g.uvs[i]).toBeLessThanOrEqual(1);
    }
    // The top region is used by some faces.
    const [tx0, , tx1] = ATLAS_REGIONS.top;
    let topHits = 0;
    for (let i = 0; i < g.uvs.length; i += 2) {
      const u = g.uvs[i] * 2048;
      const v = g.uvs[i + 1];
      if (u > tx0 && u < tx1 && v > 0.5) topHits++;
    }
    expect(topHits).toBeGreaterThan(0);
  });

  it("keeps valid UVs on the zero-area heel faces an odd segment count creates", () => {
    // With 3 segments two heel-ring points share a height and sit on the
    // centerline, so one triangle collapses and its normal has zero length.
    const profile = { aspect: 0.5, top: [0.4, 0.9, 1, 0.7], bottom: [0.1, 0, 0, 0.6] };
    const g = buildMultiViewLoft(profile, ["outer", "inner", "top", "front", "back"], 3);
    expect(g.positions.length).toBe((profile.top.length + 1) * 3 * 2 * 9);
    for (const v of g.uvs) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("textures the steep heel faces of a finely sampled profile from the back view", () => {
    // 20 columns put the first ring close to the heel, so the faces between
    // them point mostly backwards (-x) and must sample the heel art.
    const cols = 20;
    const profile = { aspect: 0.45, top: Array(cols).fill(0.8), bottom: Array(cols).fill(0.05) };
    const g = buildMultiViewLoft(profile, ["outer", "inner", "top", "front", "back"], 12);
    const [bx0, by0, bx1, by1] = ATLAS_REGIONS.back;
    let backHits = 0;
    for (let i = 0; i < g.uvs.length; i += 2) {
      const px = g.uvs[i] * 2048;
      const py = (1 - g.uvs[i + 1]) * 1024;
      if (px > bx0 && px <= bx1 && py >= by0 && py <= by1) backHits++;
    }
    expect(backHits).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  MIKE_WHITE_COLLECTION,
  MIKE_WHITE_COLLECTION_NAME,
  MIKE_WHITE_CREDIT,
  MIKE_WHITE_SIGNATURE_SHOE,
  MIKE_WHITE_SIGNATURE_URL,
  designerCreditFor,
  mikeWhiteSeedActions,
} from "../mikeWhiteCollection";

const publicPath = (url: string) => join(process.cwd(), "public", url);

describe("Mike White Signature collection", () => {
  it("keeps the original shoe under its launch id", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.itemDefId).toBe("mike_white_signature_001");
    expect(MIKE_WHITE_SIGNATURE_SHOE.name).toMatch(/^Mike White Signature/);
  });

  it("credits Mike on every item and puts each in his collection", () => {
    expect(MIKE_WHITE_COLLECTION.length).toBeGreaterThan(30);
    for (const item of MIKE_WHITE_COLLECTION) {
      expect(item.designer.credit).toBe(MIKE_WHITE_CREDIT);
      expect(item.designer.collectionName).toBe(MIKE_WHITE_COLLECTION_NAME);
      expect(item.licensed.brand).toBe("Mike White");
    }
  });

  it("is never sold for Bucks", () => {
    for (const item of MIKE_WHITE_COLLECTION) {
      expect(item.priceBucks).toBeNull();
      expect(item.source).toBe("pro_signature");
    }
  });

  it("has no duplicate ids or duplicate art", () => {
    const ids = MIKE_WHITE_COLLECTION.map((i) => i.itemDefId);
    const art = MIKE_WHITE_COLLECTION.map((i) => i.artUrl);
    const names = MIKE_WHITE_COLLECTION.map((i) => i.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(art).size).toBe(art.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ships the art and the signature it points at", () => {
    expect(existsSync(publicPath(MIKE_WHITE_SIGNATURE_URL))).toBe(true);
    for (const item of MIKE_WHITE_COLLECTION) {
      expect(existsSync(publicPath(item.artUrl))).toBe(true);
    }
  });

  it("looks credit up by item definition id", () => {
    expect(designerCreditFor("mike_white_teeth_fire")?.credit).toBe(MIKE_WHITE_CREDIT);
    expect(designerCreditFor("some_other_deck")).toBeNull();
    expect(designerCreditFor(null)).toBeNull();
    expect(designerCreditFor(undefined)).toBeNull();
  });

  it("builds one closetAdmin seed action per item", () => {
    const actions = mikeWhiteSeedActions();
    expect(actions).toHaveLength(MIKE_WHITE_COLLECTION.length);
    expect(actions[0]).toEqual({
      action: "createItem",
      params: { itemDefId: MIKE_WHITE_SIGNATURE_SHOE.itemDefId, item: MIKE_WHITE_SIGNATURE_SHOE },
    });
  });
});

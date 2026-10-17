import { describe, it, expect } from "vitest";
import { MIKE_WHITE_SIGNATURE_SHOE, createMikeWhiteShoeItem } from "../mikeWhiteShoe";

describe("Mike White Signature Shoe", () => {
  it("has correct item definition", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.itemDefId).toBe("mike_white_signature_001");
    expect(MIKE_WHITE_SIGNATURE_SHOE.name).toBe("Mike White Signature");
    expect(MIKE_WHITE_SIGNATURE_SHOE.slot).toBe("shoes");
    expect(MIKE_WHITE_SIGNATURE_SHOE.rarity).toBe("limited");
  });

  it("is a pro signature item", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.source).toBe("pro_signature");
    expect(MIKE_WHITE_SIGNATURE_SHOE.licensed.brand).toBe("Mike White");
    expect(MIKE_WHITE_SIGNATURE_SHOE.metadata.category).toBe("pro_signature");
  });

  it("is not purchasable", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.priceBucks).toBeNull();
    expect(MIKE_WHITE_SIGNATURE_SHOE.metadata.purchasable).toBe(false);
  });

  it("is earnable", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.metadata.earnable).toBe(true);
  });

  it("has correct asset paths", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.artUrl).toBe("/assets/closet/shoes/mike-white-signature-card.png");
    expect(MIKE_WHITE_SIGNATURE_SHOE.layerUrls.front).toBe("/assets/closet/shoes/mike-white-signature-avatar.png");
    expect(MIKE_WHITE_SIGNATURE_SHOE.layerUrls.back).toBeNull();
  });

  it("has limited edition with 1000 supply", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.edition.kind).toBe("limited");
    expect(MIKE_WHITE_SIGNATURE_SHOE.edition.supply).toBe(1000);
    expect(MIKE_WHITE_SIGNATURE_SHOE.edition.minted).toBe(0);
    expect(MIKE_WHITE_SIGNATURE_SHOE.edition.soldOut).toBe(false);
  });

  it("has correct design metadata", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.metadata.designer).toBe("Mike White");
    expect(MIKE_WHITE_SIGNATURE_SHOE.metadata.colorway).toBe("Tan/White/Navy");
    expect(MIKE_WHITE_SIGNATURE_SHOE.metadata.features).toContain("Yellow laces");
    expect(MIKE_WHITE_SIGNATURE_SHOE.metadata.features).toContain("black-on-yellow triangle logo");
  });

  it("creates admin action payload", () => {
    const action = createMikeWhiteShoeItem();
    expect(action.action).toBe("createItem");
    expect(action.params.itemDefId).toBe("mike_white_signature_001");
    expect(action.params.item).toEqual(MIKE_WHITE_SIGNATURE_SHOE);
  });

  it("is not yet released", () => {
    expect(MIKE_WHITE_SIGNATURE_SHOE.releasedAt).toBeNull();
    expect(MIKE_WHITE_SIGNATURE_SHOE.retiredAt).toBeNull();
  });
});

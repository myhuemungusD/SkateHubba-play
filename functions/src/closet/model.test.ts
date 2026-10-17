import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { ClosetError, isId, isReleased, num, parseDef, paths, str, toMillis, utcDay, DAY_MS } from "./model.js";
import { defDoc, NOW } from "./testkit.js";

describe("closet model helpers", () => {
  it("coerces primitives safely", () => {
    expect(str(1)).toBe("");
    expect(str("a")).toBe("a");
    expect(num(Number.NaN)).toBe(0);
    expect(num(4)).toBe(4);
    expect(toMillis(Timestamp.fromMillis(5))).toBe(5);
    expect(toMillis(7)).toBe(7);
    expect(toMillis("x")).toBeNull();
    expect(utcDay(DAY_MS * 3 + 1)).toBe(3);
  });

  it("validates ids", () => {
    expect(isId("abc")).toBe(true);
    expect(isId("")).toBe(false);
    expect(isId("a/b")).toBe(false);
    expect(isId("x".repeat(129))).toBe(false);
    expect(isId(3)).toBe(false);
  });

  it("builds paths", () => {
    expect(paths.serial("deck", 7)).toBe("serials/deck_7");
    expect(paths.claim("d", "u")).toBe("drops/d/claims/u");
    expect(paths.limits("u")).toBe("users/u/closetLimits/daily");
  });
});

describe("parseDef", () => {
  it("parses a full doc", () => {
    const def = parseDef(defDoc({ model3dUrl: "https://m", licensed: { brand: "B", licenseRef: "L1" } }));
    expect(def).toMatchObject({
      slot: "shoes",
      rarity: "limited",
      edition: { kind: "limited", supply: 150, minted: 0, soldOut: false },
      priceBucks: 1000,
      dropId: "d1",
      model3dUrl: "https://m",
      licensed: { brand: "B", licenseRef: "L1" },
      retiredAtMs: null,
    });
  });

  it("defaults missing optional parts", () => {
    const def = parseDef(
      defDoc({ layerUrls: undefined, licensed: undefined, edition: { kind: "open" }, priceBucks: undefined }),
    );
    expect(def.layerUrls).toEqual({ front: "", back: null });
    expect(def.edition).toEqual({ kind: "open", supply: null, minted: 0, soldOut: false });
    expect(def.priceBucks).toBeNull();
  });

  it("rejects missing or malformed docs", () => {
    expect(() => parseDef(undefined)).toThrow(new ClosetError("not_found"));
    expect(() => parseDef(defDoc({ slot: "hat" }))).toThrow("bad_item");
    expect(() => parseDef(defDoc({ edition: undefined }))).toThrow("bad_item");
    expect(() => parseDef(defDoc({ name: "" }))).toThrow("bad_item");
  });

  it("knows when an item is on sale", () => {
    const def = parseDef(defDoc());
    expect(isReleased(def, NOW)).toBe(true);
    expect(isReleased({ ...def, releasedAtMs: null }, NOW)).toBe(false);
    expect(isReleased({ ...def, releasedAtMs: NOW + 1 }, NOW)).toBe(false);
    expect(isReleased({ ...def, retiredAtMs: NOW }, NOW)).toBe(false);
    expect(isReleased({ ...def, retiredAtMs: NOW + 1 }, NOW)).toBe(true);
  });
});

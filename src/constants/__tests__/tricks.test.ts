import { afterEach, describe, expect, it } from "vitest";
import {
  OTHER_TRICK_ID,
  POPULAR_TRICK_IDS,
  TRICK_CATALOG_CATEGORIES,
  TRICKS,
  buildTrickPickerRows,
  formatTrickDisplayName,
  isValidTrickSelection,
  readRecentTrickIds,
  rememberRecentTrick,
  sanitizeTrickCustom,
  trickById,
  type TrickSelection,
  type TrickStance,
} from "../tricks";

const kickflip: TrickSelection = {
  trickId: "kickflip",
  stance: "regular",
  obstacle: null,
  trickNameCustom: null,
};

afterEach(() => {
  localStorage.removeItem("skatehubba.recentTrickIds");
});

describe("trick catalog", () => {
  it("covers the common families without overflowing the name cap", () => {
    expect(TRICKS.length).toBeGreaterThanOrEqual(60);
    expect(TRICKS.length).toBeLessThanOrEqual(100);
    for (const category of TRICK_CATALOG_CATEGORIES) {
      expect(TRICKS.some((trick) => trick.category === category.id)).toBe(true);
    }
    for (const id of POPULAR_TRICK_IDS) {
      expect(trickById(id)?.name.length).toBeLessThanOrEqual(64);
    }
    expect(trickById("not-real")).toBeUndefined();
  });

  it("formats stance prefixes and keeps Other as free text", () => {
    expect(formatTrickDisplayName(kickflip)).toBe("Kickflip");
    expect(formatTrickDisplayName({ ...kickflip, stance: "switch" })).toBe("Switch Kickflip");
    expect(formatTrickDisplayName({ ...kickflip, stance: "nollie" })).toBe("Nollie Kickflip");
    expect(formatTrickDisplayName({ ...kickflip, stance: "fakie" })).toBe("Fakie Kickflip");
    expect(
      formatTrickDisplayName({
        trickId: OTHER_TRICK_ID,
        stance: "switch",
        obstacle: "rail",
        trickNameCustom: "  Casper flip  ",
      }),
    ).toBe("Switch Casper flip");
    expect(
      formatTrickDisplayName({
        trickId: "missing",
        stance: "nope" as TrickStance,
        obstacle: null,
        trickNameCustom: null,
      }),
    ).toBe("");
  });

  it("rejects selections the catalog does not recognize", () => {
    expect(isValidTrickSelection(kickflip)).toBe(true);
    expect(isValidTrickSelection({ ...kickflip, trickNameCustom: "   " })).toBe(true);
    expect(isValidTrickSelection({ ...kickflip, trickNameCustom: "extra" })).toBe(false);
    expect(isValidTrickSelection({ ...kickflip, trickId: "nope" })).toBe(false);
    expect(isValidTrickSelection({ ...kickflip, stance: "goofy" as TrickStance })).toBe(false);
    expect(isValidTrickSelection({ ...kickflip, obstacle: "curb" as TrickSelection["obstacle"] })).toBe(false);
    expect(
      isValidTrickSelection({
        trickId: OTHER_TRICK_ID,
        stance: "regular",
        obstacle: null,
        trickNameCustom: "   ",
      }),
    ).toBe(false);
    expect(
      isValidTrickSelection({
        trickId: OTHER_TRICK_ID,
        stance: "regular",
        obstacle: "manual-pad",
        trickNameCustom: "Casper",
      }),
    ).toBe(true);
  });

  it("strips control characters from custom names", () => {
    expect(sanitizeTrickCustom(null)).toBeNull();
    expect(sanitizeTrickCustom("  \u0001kick\u007f  ")).toBe("kick");
    expect(sanitizeTrickCustom("   ")).toBeNull();
    expect(sanitizeTrickCustom("a".repeat(80))?.length).toBe(64);
  });

  it("leads with recent, then popular, and ranks a search the same way", () => {
    const rows = buildTrickPickerRows("", ["kickflip"]);
    expect(rows[0]).toMatchObject({ kind: "header", label: "Recent" });
    expect(rows[1]).toMatchObject({ kind: "trick", label: "Kickflip" });
    expect(rows.find((row) => row.id === "header-popular")).toBeTruthy();
    expect(rows.find((row) => row.id === "popular-kickflip")).toBeUndefined();
    expect(rows.find((row) => row.id === "header-flip")).toBeTruthy();

    const hits = buildTrickPickerRows("flip", ["heelflip"]);
    expect(hits[0]?.label).toBe("Heelflip");
    expect(hits.map((row) => row.label)).toContain("Kickflip");
    expect(buildTrickPickerRows("kf", [])[0]?.label).toBe("Kickflip");
    expect(buildTrickPickerRows("zzz", [])).toEqual([]);
    expect(buildTrickPickerRows("", []).some((row) => row.id === "header-recent")).toBe(false);
  });

  it("remembers a short recent list and ignores junk storage", () => {
    rememberRecentTrick("not-real");
    expect(readRecentTrickIds()).toEqual([]);
    rememberRecentTrick("kickflip");
    rememberRecentTrick("heelflip");
    rememberRecentTrick("kickflip");
    expect(readRecentTrickIds()).toEqual(["kickflip", "heelflip"]);

    localStorage.setItem("skatehubba.recentTrickIds", "not-json");
    expect(readRecentTrickIds()).toEqual([]);
    localStorage.setItem("skatehubba.recentTrickIds", JSON.stringify({ nope: true }));
    expect(readRecentTrickIds()).toEqual([]);
    localStorage.setItem("skatehubba.recentTrickIds", JSON.stringify(["nope", "ollie", 4]));
    expect(readRecentTrickIds()).toEqual(["ollie"]);

    const throwing = {
      getItem: () => "[]",
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => rememberRecentTrick("ollie", throwing)).not.toThrow();
    expect(readRecentTrickIds(null)).toEqual([]);
    rememberRecentTrick("ollie", null);
  });

  it("treats a blocked localStorage as no history", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(readRecentTrickIds()).toEqual([]);
    expect(() => rememberRecentTrick("kickflip")).not.toThrow();
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
  });
});

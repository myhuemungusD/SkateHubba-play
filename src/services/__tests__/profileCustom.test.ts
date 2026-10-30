import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  warn: vi.fn(),
  uid: { value: "u1" as string | null },
}));

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  collection: (_db: unknown, ...p: string[]) => p.join("/"),
  where: (...a: unknown[]) => ({ where: a }),
  limit: (n: number) => ({ limit: n }),
  query: (...a: unknown[]) => a,
  getDoc: h.getDoc,
  getDocs: h.getDocs,
  setDoc: h.setDoc,
  serverTimestamp: () => "TS",
}));
vi.mock("../../firebase", () => ({
  requireAuth: () => ({ currentUser: h.uid.value === null ? null : { uid: h.uid.value } }),
  requireDb: () => ({}),
}));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));

import {
  DEFAULT_PROFILE_CUSTOM,
  LIMITS,
  LINK_HOSTS,
  LINK_PATTERN,
  SECTION_IDS,
  escapeRegExp,
  fetchPinnableClips,
  fetchPinnedClips,
  getProfileCustom,
  gradientCss,
  isAllowedLink,
  isHexColor,
  moveSection,
  normalizeSections,
  sanitizeProfileCustom,
  saveProfileCustom,
  togglePinnedClip,
} from "../profileCustom";
import { MUSIC_TRACKS } from "../../lib/clipEditor/musicLibrary";
import { readFileSync } from "node:fs";

const snap = (data: Record<string, unknown> | undefined) => ({ exists: () => data !== undefined, data: () => data });

beforeEach(() => {
  vi.clearAllMocks();
  h.uid.value = "u1";
});

describe("link allowlist", () => {
  it("accepts allowlisted https hosts and subdomains", () => {
    expect(isAllowedLink("https://instagram.com/mike")).toBe(true);
    expect(isAllowedLink("https://www.tiktok.com/@mike")).toBe(true);
    expect(isAllowedLink("https://mike.myshopify.com")).toBe(true);
  });
  it("rejects http, look-alikes, spaces and long urls", () => {
    expect(isAllowedLink("http://instagram.com/a")).toBe(false);
    expect(isAllowedLink("https://instagram.com.evil.com")).toBe(false);
    expect(isAllowedLink("https://evil.com/instagram.com")).toBe(false);
    expect(isAllowedLink("https://x.com/a b")).toBe(false);
    expect(isAllowedLink("https://x.com/" + "a".repeat(LIMITS.url))).toBe(false);
  });
  it("matches the firestore.rules allowlist and song list", () => {
    const rules = readFileSync("firestore.rules", "utf8");
    for (const host of LINK_HOSTS) expect(rules).toContain(host.replace(/\./g, "\\\\."));
    for (const t of MUSIC_TRACKS) expect(rules).toContain(`'${t.id}'`);
  });
});

describe("escapeRegExp (CodeQL js/incomplete-sanitization #10)", () => {
  it("escapes backslashes and every other metacharacter", () => {
    expect(escapeRegExp("a\\b")).toBe("a\\\\b");
    const nasty = "^$.*+?()[]{}|\\";
    expect(new RegExp(`^${escapeRegExp(nasty)}$`).test(nasty)).toBe(true);
  });
  it("leaves the link pattern for the real host list unchanged", () => {
    const legacy = `^https://([a-z0-9-]+\\.)?(${LINK_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})(/[^\\s]*)?$`;
    expect(LINK_PATTERN).toBe(legacy);
  });
});

describe("helpers", () => {
  it("isHexColor", () => {
    expect(isHexColor("#a1B2c3")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor(5)).toBe(false);
  });
  it("normalizeSections keeps a full permutation and rejects the rest", () => {
    const order = ["spots", "crew", "closet", "stats", "clips"];
    expect(normalizeSections(order)).toEqual(order);
    expect(normalizeSections(["clips"])).toEqual([...SECTION_IDS]);
    expect(normalizeSections(["clips", "clips", "stats", "closet", "crew"])).toEqual([...SECTION_IDS]);
    expect(normalizeSections(["clips", "stats", "closet", "crew", "crew"])).toEqual([...SECTION_IDS]);
    expect(normalizeSections("x")).toEqual([...SECTION_IDS]);
  });
  it("moveSection swaps neighbours and ignores out-of-range moves", () => {
    const o = [...SECTION_IDS];
    expect(moveSection(o, "stats", -1).slice(0, 2)).toEqual(["stats", "clips"]);
    expect(moveSection(o, "clips", -1)).toBe(o);
    expect(moveSection(o, "spots", 1)).toBe(o);
    expect(moveSection(["clips"] as never, "spots", 1)).toEqual(["clips"]);
  });
  it("togglePinnedClip adds, removes and caps at 3", () => {
    expect(togglePinnedClip([], "a")).toEqual(["a"]);
    expect(togglePinnedClip(["a", "b"], "a")).toEqual(["b"]);
    expect(togglePinnedClip(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
  });
  it("gradientCss", () => {
    expect(gradientCss(DEFAULT_PROFILE_CUSTOM)).toBe("linear-gradient(180deg, #1A1A1A, #0A0A0A)");
  });
});

const LOOK = {
  accent: "#00FF00",
  gradientFrom: "#111111",
  gradientTo: "#222222",
  gradientAngle: 45,
  bannerPosX: 10,
  bannerPosY: 90,
  bannerZoom: 150,
  sections: ["crew", "clips", "stats", "closet", "spots"],
};

describe("sanitizeProfileCustom", () => {
  it("returns defaults for junk", () => {
    expect(sanitizeProfileCustom(null)).toEqual(DEFAULT_PROFILE_CUSTOM);
    expect(sanitizeProfileCustom({ links: "x", gradientAngle: 1.5, bannerZoom: 300 })).toEqual(DEFAULT_PROFILE_CUSTOM);
  });
  it("keeps valid values and drops bad entries", () => {
    const out = sanitizeProfileCustom({
      ...LOOK,
      pinnedClipIds: ["a", "a", "", 5, "b", "c", "d", "x".repeat(200)],
      showcaseSignature: false,
      bio: "  hi  ",
      links: [
        { label: "IG", url: "https://instagram.com/m" },
        { label: "", url: "https://instagram.com/m" },
        { label: "bad", url: "https://evil.com" },
        null,
      ],
      sponsors: [
        { name: "B-One", url: "" },
        { name: "Shop", url: "https://etsy.com/s" },
        { name: "x", url: "https://evil.com" },
        {},
        null,
      ],
      favoriteTricks: ["Kickflip", "", 3, "a", "b", "c", "d", "e"],
      themeSongId: "lofi-75",
    });
    expect(out).toEqual({
      ...LOOK,
      pinnedClipIds: ["a", "b", "c"],
      showcaseSignature: false,
      bio: "hi",
      links: [{ label: "IG", url: "https://instagram.com/m" }],
      sponsors: [
        { name: "B-One", url: "" },
        { name: "Shop", url: "https://etsy.com/s" },
      ],
      favoriteTricks: ["Kickflip", "a", "b", "c", "d"],
      themeSongId: "lofi-75",
    });
  });
  it("drops unknown theme songs", () => {
    expect(sanitizeProfileCustom({ themeSongId: "nope" }).themeSongId).toBe("");
    expect(sanitizeProfileCustom({ themeSongId: 4 }).themeSongId).toBe("");
  });
});

describe("Firestore I/O", () => {
  it("getProfileCustom returns sanitized data, null when missing, null on error", async () => {
    h.getDoc.mockResolvedValueOnce(snap({ bio: "yo" }));
    expect((await getProfileCustom("u1"))?.bio).toBe("yo");
    h.getDoc.mockResolvedValueOnce(snap(undefined));
    expect(await getProfileCustom("u1")).toBeNull();
    h.getDoc.mockRejectedValueOnce(new Error("denied"));
    expect(await getProfileCustom("u1")).toBeNull();
    h.getDoc.mockRejectedValueOnce("weird");
    expect(await getProfileCustom("u1")).toBeNull();
    expect(h.warn).toHaveBeenCalledTimes(2);
  });

  it("saveProfileCustom writes the sanitized doc with a server timestamp", async () => {
    h.setDoc.mockResolvedValueOnce(undefined);
    const out = await saveProfileCustom("u1", { ...DEFAULT_PROFILE_CUSTOM, bio: " a " });
    expect(out.bio).toBe("a");
    expect(h.setDoc).toHaveBeenCalledWith("users/u1/profileCustom/main", { ...out, updatedAt: "TS" });
  });

  it("saveProfileCustom refuses other or missing users", async () => {
    await expect(saveProfileCustom("u2", DEFAULT_PROFILE_CUSTOM)).rejects.toThrow("profile_custom_unauthenticated");
    h.uid.value = null;
    await expect(saveProfileCustom("u1", DEFAULT_PROFILE_CUSTOM)).rejects.toThrow("profile_custom_unauthenticated");
  });

  it("fetchPinnableClips maps valid user posts and returns [] on error", async () => {
    h.getDocs.mockResolvedValueOnce({
      docs: [
        { id: "a", data: () => ({ source: "user", trickName: "Kickflip", videoUrl: "v", thumbnailUrl: "t" }) },
        { id: "b", data: () => ({ source: "user", trickName: "Heel", videoUrl: "v2" }) },
        { id: "c", data: () => ({ source: "user", trickName: 3 }) },
        { id: "d", data: () => undefined },
        // Game clips and legacy clips with no source stay off the profile.
        { id: "g", data: () => ({ source: "game", trickName: "Game", videoUrl: "vg" }) },
        { id: "l", data: () => ({ trickName: "Legacy", videoUrl: "vl" }) },
      ],
    });
    expect(await fetchPinnableClips("u1")).toEqual([
      { id: "a", trickName: "Kickflip", videoUrl: "v", thumbnailUrl: "t" },
      { id: "b", trickName: "Heel", videoUrl: "v2", thumbnailUrl: null },
    ]);
    h.getDocs.mockRejectedValueOnce(new Error("x"));
    expect(await fetchPinnableClips("u1")).toEqual([]);
    h.getDocs.mockRejectedValueOnce("x");
    expect(await fetchPinnableClips("u1")).toEqual([]);
  });

  it("fetchPinnedClips keeps order and skips missing, foreign and unreadable clips", async () => {
    h.getDoc.mockImplementation(async (path: string) => {
      if (path === "clips/a") return snap({ source: "user", playerUid: "u1", trickName: "A", videoUrl: "va" });
      if (path === "clips/b") return snap({ source: "user", playerUid: "u2", trickName: "B", videoUrl: "vb" });
      if (path === "clips/g") return snap({ source: "game", playerUid: "u1", trickName: "G", videoUrl: "vg" });
      if (path === "clips/l") return snap({ playerUid: "u1", trickName: "L", videoUrl: "vl" });
      if (path === "clips/c") return snap(undefined);
      throw new Error("denied");
    });
    expect((await fetchPinnedClips("u1", ["d", "b", "c", "a"])).length).toBe(0);
    expect(await fetchPinnedClips("u1", ["a", "b", "c", "g", "l"])).toEqual([
      { id: "a", trickName: "A", videoUrl: "va", thumbnailUrl: null },
    ]);
  });
});

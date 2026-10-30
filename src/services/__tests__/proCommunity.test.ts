import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  addDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  uidByName: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  collection: (_db: unknown, ...p: string[]) => p.join("/"),
  where: (...a: unknown[]) => ({ where: a }),
  orderBy: (...a: unknown[]) => ({ orderBy: a }),
  limit: (n: number) => ({ limit: n }),
  startAfter: (d: { id: string }) => ({ startAfter: d.id }),
  query: (...a: unknown[]) => a,
  serverTimestamp: () => "TS",
  addDoc: h.addDoc,
  getDoc: h.getDoc,
  getDocs: h.getDocs,
  setDoc: h.setDoc,
  updateDoc: h.updateDoc,
  deleteDoc: h.deleteDoc,
}));
vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));
vi.mock("../users", () => ({ getUidByUsername: h.uidByName }));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));

import {
  createChallenge,
  enterChallenge,
  featureClip,
  giveProps,
  listChallenges,
  listEntries,
  listFeaturedClips,
  listPropsFor,
  setEntryFeatured,
  unfeatureClip,
} from "../proCommunity";

const pro = { uid: "p", username: "mike" };
const qd = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

beforeEach(() => vi.clearAllMocks());

describe("challenges", () => {
  it("creates a trimmed challenge and validates the trick", async () => {
    h.addDoc.mockResolvedValue({ id: "c1" });
    expect(await createChallenge(pro, "  kickflip ", " " + "d".repeat(300))).toBe("c1");
    expect(h.addDoc.mock.calls[0][1]).toMatchObject({ proUid: "p", trickName: "kickflip", createdAt: "TS" });
    expect(h.addDoc.mock.calls[0][1].description).toHaveLength(280);
    await expect(createChallenge(pro, " ", "")).rejects.toThrow("Name the trick");
    await expect(createChallenge(pro, "x".repeat(61), "")).rejects.toThrow("Name the trick");
  });
  it("lists challenges and entries (featured first) with safe fallbacks", async () => {
    h.getDocs.mockResolvedValueOnce({ docs: [qd("c1", { proUid: "p", trickName: "kf", proUsername: 1 })] });
    expect(await listChallenges()).toEqual([
      { id: "c1", proUid: "p", proUsername: "", trickName: "kf", description: "" },
    ]);
    h.getDocs.mockResolvedValueOnce({
      docs: [qd("e1", { uid: "a", featured: false }), qd("e2", { uid: "b", featured: true, clipId: "x" })],
    });
    expect((await listEntries("c1")).map((e) => e.id)).toEqual(["e2", "e1"]);
    h.getDocs.mockRejectedValueOnce(new Error("x")).mockRejectedValueOnce("y");
    expect(await listChallenges()).toEqual([]);
    expect(await listEntries("c1")).toEqual([]);
    expect(h.warn).toHaveBeenCalledWith("pro_challenge_entries_failed", { error: "y" });
  });
  it("enters with a deterministic id and lets the pro feature a make", async () => {
    await enterChallenge("c1", { uid: "u", username: "kid" }, "clip1");
    expect(h.setDoc).toHaveBeenCalledWith("proChallengeEntries/c1_u", {
      challengeId: "c1",
      uid: "u",
      username: "kid",
      clipId: "clip1",
      featured: false,
      createdAt: "TS",
    });
    await setEntryFeatured("c1_u", true);
    expect(h.updateDoc).toHaveBeenCalledWith("proChallengeEntries/c1_u", { featured: true });
  });
});

describe("props", () => {
  it("validates sticker, target and self", async () => {
    await expect(giveProps(pro, "kid", "nope" as "fire", "")).rejects.toThrow("Pick a sticker.");
    await expect(giveProps(pro, " @ ", "fire", "")).rejects.toThrow("No skater");
    h.uidByName.mockResolvedValueOnce(null);
    await expect(giveProps(pro, "ghost", "fire", "")).rejects.toThrow("No skater");
    h.uidByName.mockResolvedValueOnce("p");
    await expect(giveProps(pro, "mike", "fire", "")).rejects.toThrow("other skaters");
  });
  it("sends props and lists them", async () => {
    h.uidByName.mockResolvedValue("k");
    await giveProps(pro, "@Kid", "steez", " " + "n".repeat(200));
    const data = h.addDoc.mock.calls[0][1];
    expect(data).toMatchObject({ fromUid: "p", toUid: "k", toUsername: "kid", sticker: "steez" });
    expect(data.note).toHaveLength(140);
    h.getDocs.mockResolvedValueOnce({ docs: [qd("x", { sticker: "fire", fromUsername: "mike" })] });
    expect(await listPropsFor("k")).toEqual([
      { id: "x", fromUid: "", fromUsername: "mike", toUid: "", toUsername: "", sticker: "fire", note: "" },
    ]);
    h.getDocs.mockRejectedValueOnce(new Error("x"));
    expect(await listPropsFor("k")).toEqual([]);
  });
});

describe("featured clips", () => {
  it("lists featured clips with clip info and fallbacks", async () => {
    h.getDocs.mockResolvedValueOnce({
      docs: [qd("a", { proUid: "p", proUsername: "mike" }), qd("b", {}), qd("c", {}), qd("g", {})],
    });
    h.getDoc.mockImplementation(async (p: string) => {
      if (p === "clips/a")
        return { exists: () => true, data: () => ({ source: "user", videoUrl: "v", trickName: "kf" }) };
      if (p === "clips/g")
        return { exists: () => true, data: () => ({ source: "game", videoUrl: "vg", trickName: "g" }) };
      if (p === "clips/b") return { exists: () => false, data: () => undefined };
      throw new Error("denied");
    });
    expect(await listFeaturedClips()).toEqual([
      { clipId: "a", proUid: "p", proUsername: "mike", videoUrl: "v", trickName: "kf", userClip: true },
      { clipId: "b", proUid: "", proUsername: "", videoUrl: null, trickName: "", userClip: false },
      { clipId: "c", proUid: "", proUsername: "", videoUrl: null, trickName: "", userClip: false },
      // A game clip is still listed (so the pro can unpin it), flagged as not a user post.
      { clipId: "g", proUid: "", proUsername: "", videoUrl: "vg", trickName: "g", userClip: false },
    ]);
    h.getDocs.mockRejectedValueOnce(new Error("x"));
    expect(await listFeaturedClips()).toEqual([]);
  });

  describe("userPostsOnly page-fill", () => {
    /** One featured page: `u*` ids are user posts, anything else a game clip. */
    const page = (ids: string[]) => ({ docs: ids.map((id) => qd(id, { proUid: "p", proUsername: "mike" })) });
    const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
    const queryCursors = () =>
      h.getDocs.mock.calls.map(([q]) =>
        (q as unknown[]).find((c) => typeof c === "object" && c !== null && "startAfter" in c),
      );

    beforeEach(() => {
      h.getDoc.mockImplementation(async (p: string) => ({
        exists: () => true,
        data: () => ({ source: p.startsWith("clips/u") ? "user" : "game", videoUrl: "v", trickName: p }),
      }));
    });

    it("pages past featured game clips instead of coming up short", async () => {
      h.getDocs.mockResolvedValueOnce(page([...ids("g", 28), "u-a", "u-b"])).mockResolvedValueOnce(page(ids("u", 5)));
      const out = await listFeaturedClips({ userPostsOnly: true });
      expect(out.map((c) => c.clipId)).toEqual(["u-a", "u-b", ...ids("u", 5)]);
      expect(out.every((c) => c.userClip)).toBe(true);
      expect(queryCursors()).toEqual([undefined, { startAfter: "u-b" }]);
    });

    it("stops at 3 pages when every feature is a game clip", async () => {
      h.getDocs.mockResolvedValue(page(ids("g", 30)));
      expect(await listFeaturedClips({ userPostsOnly: true })).toEqual([]);
      expect(h.getDocs).toHaveBeenCalledTimes(3);
    });

    it("stops once the list is full and caps it at 30", async () => {
      h.getDocs
        .mockResolvedValueOnce(page([...ids("ua", 10), ...ids("g", 20)]))
        .mockResolvedValueOnce(page(ids("ub", 30)));
      const out = await listFeaturedClips({ userPostsOnly: true });
      expect(out).toHaveLength(30);
      expect(out.map((c) => c.clipId)).toEqual([...ids("ua", 10), ...ids("ub", 20)]);
      expect(h.getDocs).toHaveBeenCalledTimes(2);
    });

    it("lists every feature from one full page when not filtering", async () => {
      h.getDocs.mockResolvedValueOnce(page([...ids("g", 15), ...ids("u", 15)]));
      expect(await listFeaturedClips()).toHaveLength(30);
      expect(h.getDocs).toHaveBeenCalledTimes(1);
    });
  });
  it("features up to the cap and unpins", async () => {
    await expect(featureClip(pro, " ")).rejects.toThrow("Paste a clip id.");
    h.getDocs.mockResolvedValueOnce({ size: 3 });
    await expect(featureClip(pro, "c1")).rejects.toThrow("up to 3");
    h.getDocs.mockResolvedValueOnce({ size: 1 });
    await featureClip(pro, " c1 ");
    expect(h.setDoc).toHaveBeenCalledWith("proFeatured/c1", {
      clipId: "c1",
      proUid: "p",
      proUsername: "mike",
      createdAt: "TS",
    });
    await unfeatureClip("c1");
    expect(h.deleteDoc).toHaveBeenCalledWith("proFeatured/c1");
  });
});

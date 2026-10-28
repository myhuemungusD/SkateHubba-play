import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getProfileCustom: vi.fn(),
  fetchPinnedClips: vi.fn(),
  getSpot: vi.fn(),
  listSpotsByCreator: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...p: string[]) => p.join("/"),
  where: (...a: unknown[]) => ({ where: a }),
  limit: (n: number) => ({ limit: n }),
  query: (...a: unknown[]) => a,
  getDocs: h.getDocs,
}));
vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));
vi.mock("../profileCustom", () => ({ getProfileCustom: h.getProfileCustom, fetchPinnedClips: h.fetchPinnedClips }));
vi.mock("../spots", () => ({ getSpot: h.getSpot, listSpotsByCreator: h.listSpotsByCreator }));

import { fetchProClipReel, fetchProSpots, PRO_SPOTS_LIMIT } from "../proShowcase";

const spot = (id: string, isActive = true) => ({ id, name: `Spot ${id}`, isActive });
const clipDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
const clip = (spotId: unknown, extra: Record<string, unknown> = {}) => ({
  source: "user",
  spotId,
  videoUrl: "v.mp4",
  trickName: "kickflip",
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("fetchProClipReel", () => {
  it("returns [] when there is no custom doc", async () => {
    h.getProfileCustom.mockResolvedValue(null);
    expect(await fetchProClipReel("p")).toEqual([]);
  });
  it("returns [] when nothing is pinned", async () => {
    h.getProfileCustom.mockResolvedValue({ pinnedClipIds: [] });
    expect(await fetchProClipReel("p")).toEqual([]);
    expect(h.fetchPinnedClips).not.toHaveBeenCalled();
  });
  it("resolves pinned clips in order", async () => {
    h.getProfileCustom.mockResolvedValue({ pinnedClipIds: ["a", "b"] });
    h.fetchPinnedClips.mockResolvedValue([{ id: "a" }]);
    expect(await fetchProClipReel("p")).toEqual([{ id: "a" }]);
    expect(h.fetchPinnedClips).toHaveBeenCalledWith("p", ["a", "b"]);
  });
  it("logs and returns [] on Error and non-Error failures", async () => {
    h.getProfileCustom.mockRejectedValueOnce(new Error("x"));
    expect(await fetchProClipReel("p")).toEqual([]);
    h.getProfileCustom.mockRejectedValueOnce("y");
    expect(await fetchProClipReel("p")).toEqual([]);
    expect(h.warn).toHaveBeenCalledWith("pro_clip_reel_failed", { error: "x" });
    expect(h.warn).toHaveBeenCalledWith("pro_clip_reel_failed", { error: "y" });
  });
});

describe("fetchProSpots", () => {
  it("merges created spots and clip-tagged spots, sorted by clip count", async () => {
    h.listSpotsByCreator.mockResolvedValue([spot("r1"), spot("r2")]);
    h.getDocs.mockResolvedValue({
      docs: [
        clipDoc("c1", clip("t1", { thumbnailUrl: "t.jpg" })),
        clipDoc("c2", clip("t1")),
        clipDoc("c3", clip("r2")),
        clipDoc("c4", clip(null)),
        clipDoc("c5", clip("")),
        clipDoc("c6", clip("t1", { videoUrl: 5 })),
        clipDoc("c7", clip("t1", { trickName: 5 })),
        clipDoc("c8", clip("gone")),
        clipDoc("c9", clip("dead")),
        clipDoc("c10", clip("boom")),
        // Game clips and legacy clips with no source never count toward a spot.
        clipDoc("g1", clip("t1", { source: "game" })),
        clipDoc("l1", clip("t1", { source: undefined })),
        clipDoc("g2", clip("game-only", { source: "game" })),
      ],
    });
    h.getSpot.mockImplementation(async (id: string) => {
      if (id === "gone") return null;
      if (id === "dead") return spot(id, false);
      if (id === "boom") throw new Error("nope");
      return spot(id);
    });
    const out = await fetchProSpots("p");
    expect(out.map((s) => s.spot.id)).toEqual(["t1", "r2", "r1"]);
    expect(out[0]).toMatchObject({ recommended: false });
    expect(out[0].clips).toEqual([
      { id: "c1", trickName: "kickflip", videoUrl: "v.mp4", thumbnailUrl: "t.jpg" },
      { id: "c2", trickName: "kickflip", videoUrl: "v.mp4", thumbnailUrl: null },
    ]);
    expect(out[1]).toMatchObject({ recommended: true });
    expect(out[2].clips).toEqual([]);
  });
  it("breaks clip-count ties with recommended first and caps the list", async () => {
    h.listSpotsByCreator.mockResolvedValue(Array.from({ length: PRO_SPOTS_LIMIT + 2 }, (_, i) => spot(`r${i}`)));
    h.getDocs.mockResolvedValue({ docs: [] });
    expect(await fetchProSpots("p")).toHaveLength(PRO_SPOTS_LIMIT);
  });
  it("puts a recommended spot ahead of an equal tagged one", async () => {
    h.listSpotsByCreator.mockResolvedValue([spot("r")]);
    h.getDocs.mockResolvedValue({ docs: [clipDoc("c", clip("t")), clipDoc("d", clip("r"))] });
    h.getSpot.mockResolvedValue(spot("t"));
    const out = await fetchProSpots("p");
    expect(out.map((s) => s.spot.id)).toEqual(["r", "t"]);
  });
  it("tolerates a failed creator lookup", async () => {
    h.listSpotsByCreator.mockRejectedValue(new Error("rules"));
    h.getDocs.mockResolvedValue({ docs: [clipDoc("c", clip("t"))] });
    h.getSpot.mockResolvedValue(spot("t"));
    expect((await fetchProSpots("p")).map((s) => s.spot.id)).toEqual(["t"]);
  });
  it("logs and returns [] when the clip query fails", async () => {
    h.listSpotsByCreator.mockResolvedValue([]);
    h.getDocs.mockRejectedValue(new Error("q"));
    expect(await fetchProSpots("p")).toEqual([]);
    expect(h.warn).toHaveBeenCalledWith("pro_spots_failed", { error: "q" });
  });
});

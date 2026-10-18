import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ getDocs: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), review: vi.fn(), warn: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  collection: (_db: unknown, ...p: string[]) => p.join("/"),
  where: (...a: unknown[]) => ({ where: a }),
  limit: (n: number) => ({ limit: n }),
  query: (...a: unknown[]) => a,
  serverTimestamp: () => "TS",
  getDocs: h.getDocs,
  getDoc: h.getDoc,
  setDoc: h.setDoc,
}));
vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));
vi.mock("../wtt", () => ({ submitProReview: h.review }));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));

import { fetchGoldCandidates, fetchProQueue, submitGoldClip, submitProCall } from "../proCalls";

beforeEach(() => vi.clearAllMocks());

describe("pro calls", () => {
  it("loads queued items with their clip video", async () => {
    h.getDocs.mockResolvedValue({
      docs: [
        { id: "c1", data: () => ({ options: ["a", 2, "b"], voteCount: 7 }) },
        { id: "c2", data: () => ({}) },
        { id: "c3", data: () => ({}) },
        { id: "c4", data: () => ({}) },
      ],
    });
    h.getDoc.mockImplementation(async (p: string) => {
      if (p === "clips/c1") return { exists: () => true, data: () => ({ videoUrl: "v" }) };
      if (p === "clips/c2") return { exists: () => true, data: () => ({ videoUrl: 3 }) };
      if (p === "clips/c3") return { exists: () => false, data: () => undefined };
      throw new Error("denied");
    });
    expect(await fetchProQueue()).toEqual([
      { clipId: "c1", options: ["a", "b"], videoUrl: "v", voteCount: 7 },
      { clipId: "c2", options: [], videoUrl: null, voteCount: 0 },
      { clipId: "c3", options: [], videoUrl: null, voteCount: 0 },
      { clipId: "c4", options: [], videoUrl: null, voteCount: 0 },
    ]);
    expect(h.getDocs.mock.calls[0][0]).toContainEqual({ where: ["status", "==", "pro_queue"] });
  });
  it("loads open gold candidates and degrades on errors", async () => {
    h.getDocs.mockRejectedValueOnce(new Error("rules")).mockRejectedValueOnce("x");
    expect(await fetchGoldCandidates()).toEqual([]);
    expect(await fetchProQueue()).toEqual([]);
    expect(h.warn).toHaveBeenCalledWith("pro_calls_load_failed", { status: "open", error: "rules" });
    expect(h.warn).toHaveBeenCalledWith("pro_calls_load_failed", { status: "pro_queue", error: "x" });
  });
  it("submits review calls and gold marks", async () => {
    h.review.mockResolvedValue(undefined);
    await submitProCall("c1", "p", "kickflip");
    expect(h.review).toHaveBeenCalledWith("c1", "p", "kickflip");
    await submitGoldClip("c1", "p", "kickflip");
    expect(h.setDoc).toHaveBeenCalledWith("proGold/c1", {
      clipId: "c1",
      uid: "p",
      answerTrickId: "kickflip",
      createdAt: "TS",
    });
  });
});

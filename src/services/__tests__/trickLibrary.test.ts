import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  addDoc: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getCountFromServer: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ col: name }),
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  where: (f: string, op: string, v: unknown) => ({ where: [f, op, v] }),
  limit: (n: number) => ({ limit: n }),
  query: (base: unknown, ...c: unknown[]) => ({ base, c }),
  serverTimestamp: () => "SERVER_TS",
  addDoc: h.addDoc,
  getDocs: h.getDocs,
  getDoc: h.getDoc,
  setDoc: h.setDoc,
  updateDoc: h.updateDoc,
  deleteDoc: h.deleteDoc,
  getCountFromServer: h.getCountFromServer,
}));
vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));

import {
  cleanSubmission,
  clearTrickVote,
  getMyTrickVote,
  getTrickScore,
  listApprovedTricks,
  listMySubmissions,
  listPendingTricks,
  moderateTrick,
  submitTrick,
  voteTrick,
} from "../trickLibrary";

const snap = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cleanSubmission", () => {
  it("trims and drops empty optional fields", () => {
    expect(cleanSubmission({ name: "  Kickflip ", difficulty: "beginner", description: "   " })).toEqual({
      name: "Kickflip",
      difficulty: "beginner",
    });
    expect(
      cleanSubmission({ name: "Tre", difficulty: "advanced", description: " flick it ", videoUrl: "https://v" }),
    ).toEqual({ name: "Tre", difficulty: "advanced", description: "flick it", videoUrl: "https://v" });
  });

  it("rejects bad input with plain messages", () => {
    expect(() => cleanSubmission({ name: " ", difficulty: "beginner" })).toThrow("Give the trick a name.");
    expect(() => cleanSubmission({ name: "x".repeat(61), difficulty: "beginner" })).toThrow("under 60");
    expect(() => cleanSubmission({ name: "x", difficulty: "pro" as never })).toThrow("Pick a difficulty.");
    expect(() => cleanSubmission({ name: "x", difficulty: "expert", description: "y".repeat(501) })).toThrow(
      "under 500",
    );
  });
});

describe("submitTrick", () => {
  it("writes a pending doc with a server timestamp", async () => {
    h.addDoc.mockResolvedValueOnce({ id: "t1" });
    await expect(submitTrick("u1", { name: "Heelflip", difficulty: "intermediate" })).resolves.toBe("t1");
    expect(h.addDoc).toHaveBeenCalledWith(
      { col: "trickLibrary" },
      { name: "Heelflip", difficulty: "intermediate", submittedBy: "u1", submittedAt: "SERVER_TS", status: "pending" },
    );
  });
});

describe("lists", () => {
  it("maps docs, reads timestamps, and sorts newest first", async () => {
    h.getDocs.mockResolvedValueOnce({
      docs: [
        snap("old", { name: "A", difficulty: "beginner", submittedBy: "u", submittedAt: 10, status: "approved" }),
        snap("ts", {
          name: "B",
          difficulty: "expert",
          submittedBy: "u",
          submittedAt: { toMillis: () => 50 },
          status: "approved",
          description: "d",
          videoUrl: "https://v",
        }),
        snap("pending-ts", { difficulty: "beginner", status: "approved", submittedAt: null }),
      ],
    });
    const list = await listApprovedTricks();
    expect(list.map((t) => t.id)).toEqual(["pending-ts", "ts", "old"]);
    expect(list[1]).toEqual({
      id: "ts",
      name: "B",
      difficulty: "expert",
      submittedBy: "u",
      submittedAt: 50,
      status: "approved",
      description: "d",
      videoUrl: "https://v",
    });
    expect(list[0]).toMatchObject({ name: "", submittedBy: "", submittedAt: 0 });
    expect(h.getDocs.mock.calls[0][0].c[0]).toEqual({ where: ["status", "==", "approved"] });
  });

  it("keeps two pending-timestamp docs ahead of dated ones", async () => {
    h.getDocs.mockResolvedValueOnce({
      docs: [
        snap("dated", { submittedAt: 5, status: "pending" }),
        snap("p1", { submittedAt: 0, status: "pending" }),
        snap("p2", { status: "pending" }),
      ],
    });
    const ids = (await listPendingTricks()).map((t) => t.id);
    expect(ids[2]).toBe("dated");
  });

  it("queries my submissions and the pending queue", async () => {
    h.getDocs.mockResolvedValue({ docs: [] });
    await expect(listMySubmissions("u1")).resolves.toEqual([]);
    expect(h.getDocs.mock.calls[0][0].c[0]).toEqual({ where: ["submittedBy", "==", "u1"] });
    await expect(listPendingTricks()).resolves.toEqual([]);
    expect(h.getDocs.mock.calls[1][0].c[0]).toEqual({ where: ["status", "==", "pending"] });
  });
});

describe("moderation and votes", () => {
  it("moderates with the admin uid and a server timestamp", async () => {
    await moderateTrick("admin", "t1", "approved");
    expect(h.updateDoc).toHaveBeenCalledWith("trickLibrary/t1", {
      status: "approved",
      moderatedBy: "admin",
      moderatedAt: "SERVER_TS",
    });
  });

  it("votes, clears, and reads a vote under uid_trickId", async () => {
    await voteTrick("u1", "t1", "up");
    expect(h.setDoc).toHaveBeenCalledWith("trickVotes/u1_t1", {
      trickId: "t1",
      userId: "u1",
      vote: "up",
      createdAt: "SERVER_TS",
    });
    await clearTrickVote("u1", "t1");
    expect(h.deleteDoc).toHaveBeenCalledWith("trickVotes/u1_t1");

    h.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getMyTrickVote("u1", "t1")).resolves.toBeNull();
    h.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ vote: "down" }) });
    await expect(getMyTrickVote("u1", "t1")).resolves.toBe("down");
    h.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ vote: "up" }) });
    await expect(getMyTrickVote("u1", "t1")).resolves.toBe("up");
    h.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ vote: "meh" }) });
    await expect(getMyTrickVote("u1", "t1")).resolves.toBeNull();
  });

  it("counts up and down votes", async () => {
    h.getCountFromServer
      .mockResolvedValueOnce({ data: () => ({ count: 4 }) })
      .mockResolvedValueOnce({ data: () => ({ count: 1 }) });
    await expect(getTrickScore("t1")).resolves.toEqual({ up: 4, down: 1 });
  });
});

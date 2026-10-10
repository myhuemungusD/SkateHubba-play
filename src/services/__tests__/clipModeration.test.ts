import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  app: { name: "app" } as object | null,
  emulator: false,
  docs: [] as { id: string; data: () => unknown; exists?: () => boolean }[],
  getDocResult: { exists: () => true as boolean, data: () => ({}) as Record<string, unknown> },
  callable: vi.fn(async () => ({ data: {} })),
  connect: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  doc: (_db: unknown, col: string, id: string) => ({ __path: `${col}/${id}` }),
  query: (...args: unknown[]) => ({ __query: args }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (n: number) => ({ n }),
  getDocs: vi.fn(async () => ({ docs: state.docs })),
  getDoc: vi.fn(async () => state.getDocResult),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({ region: "us-central1" }),
  httpsCallable: () => state.callable,
  connectFunctionsEmulator: (...args: unknown[]) => state.connect(...args),
}));

vi.mock("../../firebase", () => ({
  requireDb: () => ({ __db: true }),
  get default() {
    return state.app;
  },
  get isEmulatorMode() {
    return state.emulator;
  },
}));

import { getDocs, setDoc } from "firebase/firestore";
import {
  _resetClipModerationEmulator,
  decideClipModeration,
  fetchClipsInReview,
  fetchOwnClipModeration,
  loadClipAppeal,
  parseOwnClip,
  parseReviewClip,
  submitClipAppeal,
} from "../clipModeration";

beforeEach(() => {
  vi.clearAllMocks();
  state.app = { name: "app" };
  state.emulator = false;
  state.docs = [];
  state.callable.mockResolvedValue({ data: {} });
  _resetClipModerationEmulator();
});

describe("parseReviewClip", () => {
  it("reads scores, reasons, and grounds, and drops a clip that is not in review", () => {
    expect(parseReviewClip("c1", null)).toBeNull();
    expect(parseReviewClip("c1", { moderation: "approved", videoUrl: "v", playerUid: "u", trickName: "t" })).toBeNull();
    expect(parseReviewClip("c1", { moderation: "review", playerUid: "u", trickName: "t" })).toBeNull();
    expect(parseReviewClip("c1", { moderation: "review", videoUrl: "v", trickName: "t" })).toBeNull();
    expect(
      parseReviewClip("c1", {
        moderation: "review",
        videoUrl: "https://video",
        playerUid: "u1",
        trickName: "kickflip",
        playerUsername: "ada",
        moderationScores: { explicitLikelihood: "POSSIBLE", skateDetected: true, skateLabels: ["skateboard", 1] },
        reportReasons: ["not_skating", ""],
        moderationNotice: { grounds: "no skateboard detected" },
      }),
    ).toEqual({
      id: "c1",
      playerUid: "u1",
      playerUsername: "ada",
      trickName: "kickflip",
      videoUrl: "https://video",
      explicitLikelihood: "POSSIBLE",
      skateDetected: true,
      skateLabels: ["skateboard"],
      reportReasons: ["not_skating"],
      grounds: "no skateboard detected",
    });
    expect(
      parseReviewClip("c2", {
        moderation: "review",
        videoUrl: "https://video",
        playerUid: "u1",
        trickName: "ollie",
      })?.explicitLikelihood,
    ).toBe("UNKNOWN");
  });
});

describe("parseOwnClip", () => {
  it("keeps the owner's unfinished clips and describes each state", () => {
    expect(parseOwnClip("c", null)).toBeNull();
    expect(parseOwnClip("c", { source: "game", moderation: "pending" })).toBeNull();
    expect(parseOwnClip("c", { source: "user", moderation: "approved" })).toBeNull();
    expect(parseOwnClip("c", { source: "user", moderation: "pending" })).toMatchObject({
      statement: "Checking…",
      appealPath: null,
    });
    expect(parseOwnClip("c", { source: "user", moderation: "review" })).toMatchObject({ statement: "In review" });
    expect(
      parseOwnClip("c", {
        source: "user",
        moderation: "rejected",
        moderationNotice: { statement: "Too explicit.", appealPath: "/appeal/c" },
      }),
    ).toMatchObject({ statement: "Too explicit.", appealPath: "/appeal/c" });
    expect(parseOwnClip("c", { source: "user", moderation: "removed" })).toMatchObject({
      statement: "This clip was removed.",
      appealPath: "/appeal/clip_c",
      trickName: "Clip",
    });
    expect(parseOwnClip("c", { source: "user", moderation: "rejected" })).toMatchObject({
      statement: "This clip was rejected.",
      appealPath: "/appeal/clip_c",
    });
    expect(
      parseOwnClip("c", { source: "user", moderation: "removed", moderationNotice: { appealPath: "" } })?.appealPath,
    ).toBe("/appeal/clip_c");
    expect(parseReviewClip("c", 1)).toBeNull();
  });
});

describe("fetchClipsInReview", () => {
  it("returns parsed review clips and skips junk", async () => {
    state.docs = [
      {
        id: "good",
        data: () => ({
          moderation: "review",
          videoUrl: "v",
          playerUid: "u",
          trickName: "kickflip",
          playerUsername: "a",
        }),
      },
      { id: "bad", data: () => ({ moderation: "approved" }) },
    ];
    const clips = await fetchClipsInReview();
    expect(clips.map((clip) => clip.id)).toEqual(["good"]);
    expect(getDocs).toHaveBeenCalled();
  });

  it("wraps a read failure", async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error("offline"));
    await expect(fetchClipsInReview()).rejects.toThrow("Couldn't load clips in review.");
  });
});

describe("fetchOwnClipModeration", () => {
  it("returns only the caller's unfinished user clips", async () => {
    state.docs = [
      { id: "p", data: () => ({ source: "user", moderation: "pending", trickName: "ollie", playerUid: "me" }) },
      { id: "live", data: () => ({ source: "user", moderation: "approved", playerUid: "me" }) },
    ];
    const rows = await fetchOwnClipModeration("me");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statement).toBe("Checking…");
  });

  it("rejects a bad uid and a failed read", async () => {
    await expect(fetchOwnClipModeration("")).rejects.toThrow("Invalid clip.");
    await expect(fetchOwnClipModeration("x".repeat(129))).rejects.toThrow("Invalid clip.");
    vi.mocked(getDocs).mockRejectedValueOnce(new Error("offline"));
    await expect(fetchOwnClipModeration("me")).rejects.toThrow("Couldn't load your clips.");
  });
});

describe("loadClipAppeal", () => {
  it("shows the statement when the owner can appeal", async () => {
    state.getDocResult = {
      exists: () => true,
      data: () => ({
        subjectUid: "me",
        action: "content_restricted",
        explanation: "Explicit.",
        contentRef: "heel",
      }),
    };
    await expect(loadClipAppeal("me", "c1")).resolves.toMatchObject({
      canAppeal: true,
      statement: "Explicit.",
      trickName: "heel",
    });
  });

  it("refuses a missing clip, someone else's clip, and a clip that is still live", async () => {
    state.getDocResult = { exists: () => false, data: () => ({}) };
    await expect(loadClipAppeal("me", "c1")).rejects.toThrow("That clip is gone.");

    state.getDocResult = { exists: () => true, data: () => ({ subjectUid: "other", action: "content_restricted" }) };
    await expect(loadClipAppeal("me", "c1")).rejects.toThrow("You can only appeal your own clip.");

    state.getDocResult = { exists: () => true, data: () => ({ subjectUid: "me", action: "noted" }) };
    await expect(loadClipAppeal("me", "c1")).resolves.toMatchObject({
      canAppeal: false,
      statement: "",
      trickName: "Clip",
    });
  });

  it("wraps an unexpected read error", async () => {
    const { getDoc } = await import("firebase/firestore");
    vi.mocked(getDoc).mockRejectedValueOnce(new Error("offline"));
    await expect(loadClipAppeal("me", "c1")).rejects.toThrow("Couldn't open that appeal.");
    await expect(loadClipAppeal("bad/id", "c1")).rejects.toThrow("Invalid clip.");
  });
});

describe("submitClipAppeal", () => {
  it("writes one appeal per owner and clip", async () => {
    await submitClipAppeal("me", "c1", "  It is a skate video.  ");
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ __path: "appeals/statement_c1" }),
      expect.objectContaining({
        appellantUid: "me",
        targetKind: "statement",
        targetId: "c1",
        explanation: "It is a skate video.",
        status: "pending",
      }),
    );
  });

  it("rejects an empty or oversized appeal and a failed write", async () => {
    await expect(submitClipAppeal("me", "c1", "   ")).rejects.toThrow(/why this decision/);
    await expect(submitClipAppeal("me", "c1", "x".repeat(1001))).rejects.toThrow(/1000/);
    vi.mocked(setDoc).mockRejectedValueOnce(new Error("nope"));
    await expect(submitClipAppeal("me", "c1", "please")).rejects.toThrow(/Couldn't send/);
  });
});

describe("decideClipModeration", () => {
  it("calls the function for keep and remove", async () => {
    await decideClipModeration("c1", "approved", "");
    expect(state.callable).toHaveBeenCalledWith({ clipId: "c1", decision: "approved", reason: "" });
    expect(state.connect).not.toHaveBeenCalled();

    await decideClipModeration("c1", "removed", "not skating");
    expect(state.callable).toHaveBeenLastCalledWith({ clipId: "c1", decision: "removed", reason: "not skating" });
  });

  it("connects the emulator once", async () => {
    state.emulator = true;
    await decideClipModeration("c1", "approved", "");
    await decideClipModeration("c1", "approved", "");
    expect(state.connect).toHaveBeenCalledOnce();
  });

  it("rejects a bad decision, a removal without a reason, and a missing app", async () => {
    await expect(decideClipModeration("c1", "ban", "")).rejects.toThrow(/keep or remove/);
    await expect(decideClipModeration("c1", "removed", "  ")).rejects.toThrow(/reason is required/);
    await expect(decideClipModeration("a/b", "approved", "")).rejects.toThrow("Invalid clip.");
    state.app = null;
    await expect(decideClipModeration("c1", "approved", "")).rejects.toThrow("The app is not configured.");
  });

  it("surfaces the function error and a fallback when the message is empty", async () => {
    state.callable.mockRejectedValueOnce(new Error("Admins only."));
    await expect(decideClipModeration("c1", "approved", "")).rejects.toThrow("Admins only.");
    state.callable.mockRejectedValueOnce(new Error("Firebase: internal"));
    await expect(decideClipModeration("c1", "approved", "")).rejects.toThrow("Couldn't update that clip.");
    state.callable.mockRejectedValueOnce(new Error(""));
    await expect(decideClipModeration("c1", "approved", "")).rejects.toThrow("Couldn't update that clip.");
    state.callable.mockRejectedValueOnce("nope");
    await expect(decideClipModeration("c1", "approved", "")).rejects.toThrow("Couldn't update that clip.");
  });
});

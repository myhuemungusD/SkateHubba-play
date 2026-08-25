import { describe, it, expect, vi, beforeEach } from "vitest";

// In the hardened implementation, `submitReport` writes BOTH the report
// and its companion `reports_limits/{reporter_reported}` doc inside a
// single `writeBatch`. The mocks below capture every batch.set() so the
// assertions can inspect the report payload by ref and confirm the limit
// doc is part of the same commit (the Firestore rule requires this via
// getAfter()).

interface FakeRef {
  id: string;
  path: string;
}

const reportRef: FakeRef = { id: "auto-id-1", path: "reports/auto-id-1" };
const batchSet = vi.fn();
const batchCommit = vi.fn().mockResolvedValue(undefined);
const mockWriteBatch = vi.fn<(...args: unknown[]) => unknown>(() => ({ set: batchSet, commit: batchCommit }));
// `doc(collection(db, 'reports'))` returns the report ref;
// `doc(db, 'reports_limits', id)` returns a limits ref whose path contains the id.
const mockDoc = vi.fn((...args: unknown[]) => {
  if (args.length === 1) {
    // doc(collection(...)) auto-id form
    return reportRef;
  }
  const [, coll, id] = args as [unknown, string, string];
  return { id, path: `${coll}/${id}` };
});
const mockCollection = vi.fn((...args: unknown[]) => args[1]);

vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import { REPORT_REASON_LABELS, submitReport } from "../reports";

beforeEach(() => {
  vi.clearAllMocks();
  batchCommit.mockResolvedValue(undefined);
});

/** Find the set() call for the report doc (matched by ref identity). */
function reportSetCall() {
  const call = batchSet.mock.calls.find((c) => c[0] === reportRef);
  if (!call) throw new Error("no batch.set call for report ref");
  return call[1] as Record<string, unknown>;
}

/** Find the set() call for the reports_limits doc (matched by path). */
function limitSetCall() {
  const call = batchSet.mock.calls.find((c) => {
    const ref = c[0] as FakeRef;
    return ref.path.startsWith("reports_limits/");
  });
  if (!call) throw new Error("no batch.set call for reports_limits");
  return { ref: call[0] as FakeRef, data: call[1] as Record<string, unknown> };
}

describe("submitReport", () => {
  const validParams = {
    reporterUid: "user1",
    reportedUid: "user2",
    reportedUsername: "opponent",
    gameId: "game1",
    reason: "inappropriate_video" as const,
    description: "Offensive video content",
  };

  it("writes a report doc to the reports collection", async () => {
    const id = await submitReport(validParams);

    expect(id).toBe("auto-id-1");
    expect(batchCommit).toHaveBeenCalledTimes(1);
    const data = reportSetCall();
    expect(data.reporterUid).toBe("user1");
    expect(data.reportedUid).toBe("user2");
    expect(data.reportedUsername).toBe("opponent");
    expect(data.gameId).toBe("game1");
    expect(data.reason).toBe("inappropriate_video");
    expect(data.description).toBe("Offensive video content");
    expect(data.status).toBe("pending");
    expect(data.createdAt).toBe("SERVER_TS");
  });

  it("writes a companion reports_limits doc in the same batch", async () => {
    await submitReport(validParams);
    const { ref, data } = limitSetCall();
    expect(ref.path).toBe("reports_limits/user1_user2");
    expect(data.reporterUid).toBe("user1");
    expect(data.reportedUid).toBe("user2");
    expect(data.lastSentAt).toBe("SERVER_TS");
    // Both writes go through the SAME batch.commit() — the rule's
    // getAfter() check requires atomic commit.
    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(batchSet).toHaveBeenCalledTimes(2);
  });

  it("trims and caps description at 500 characters", async () => {
    const longDesc = "x".repeat(600) + "  ";
    await submitReport({ ...validParams, description: longDesc });
    const data = reportSetCall();
    expect(data.description).toHaveLength(500);
  });

  it("throws if reason is empty", async () => {
    await expect(submitReport({ ...validParams, reason: "" as never })).rejects.toThrow("Please select a reason");
  });

  it("throws if reporter and reported are the same user", async () => {
    await expect(submitReport({ ...validParams, reportedUid: "user1" })).rejects.toThrow("You cannot report yourself");
  });

  it("throws a user-friendly message when the batch commit fails", async () => {
    batchCommit.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(submitReport(validParams)).rejects.toThrow("Failed to submit report");
  });

  it("omits clipId by default (game-level report)", async () => {
    await submitReport(validParams);
    expect(reportSetCall()).not.toHaveProperty("clipId");
  });

  it("writes clipId when reporting a specific feed clip", async () => {
    await submitReport({ ...validParams, clipId: "game1_3_match" });
    expect(reportSetCall().clipId).toBe("game1_3_match");
  });

  it("caps clipId at 128 characters (defense against rule boundary)", async () => {
    await submitReport({ ...validParams, clipId: "x".repeat(300) });
    expect(reportSetCall().clipId as string).toHaveLength(128);
  });

  it("drops an empty clipId rather than writing an empty string", async () => {
    await submitReport({ ...validParams, clipId: "" });
    expect(reportSetCall()).not.toHaveProperty("clipId");
  });
});

/* ── clip-only reports (no backing game) ────────────────────── */

describe("submitReport (user-clip targets)", () => {
  const base = {
    reporterUid: "r1",
    reportedUid: "u2",
    reportedUsername: "bob",
    reason: "non_skate_content" as const,
    description: "not skating",
  };

  it("writes gameId: null when the target is a user clip", async () => {
    await submitReport({ ...base, clipId: "uc1" });

    const payload = reportSetCall();
    // Explicit null, not an omitted key — the queue distinguishes "no game"
    // from a doc that lost the field.
    expect(payload.gameId).toBeNull();
    expect(payload.clipId).toBe("uc1");
    expect(payload.reason).toBe("non_skate_content");
  });

  it("accepts an omitted gameId entirely", async () => {
    await submitReport({ ...base, clipId: "uc1", gameId: undefined });

    expect(reportSetCall().gameId).toBeNull();
  });

  it("normalises a blank gameId to null", async () => {
    await submitReport({ ...base, clipId: "uc1", gameId: "" });

    expect(reportSetCall().gameId).toBeNull();
  });

  it("refuses a report that identifies neither a game nor a clip", async () => {
    await expect(submitReport({ ...base })).rejects.toThrow(/Nothing to report/);
    expect(batchSet).not.toHaveBeenCalled();
  });

  it("still carries the gameId when one is supplied", async () => {
    await submitReport({ ...base, gameId: "g1" });

    expect(reportSetCall().gameId).toBe("g1");
  });

  it("caps an over-long clipId at 128 chars", async () => {
    await submitReport({ ...base, clipId: "c".repeat(200) });

    expect(reportSetCall().clipId).toBe("c".repeat(128));
  });
});

describe("REPORT_REASON_LABELS", () => {
  it("labels the non-skate reason distinctly from 'inappropriate'", () => {
    expect(REPORT_REASON_LABELS.non_skate_content).toBe("Not skateboarding");
    expect(REPORT_REASON_LABELS.non_skate_content).not.toBe(REPORT_REASON_LABELS.inappropriate_video);
  });
});

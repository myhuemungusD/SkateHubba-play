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
const mockWriteBatch = vi.fn(() => ({ set: batchSet, commit: batchCommit }));
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

import { submitReport } from "../reports";

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

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddDoc = vi.fn().mockResolvedValue({ id: "report1" });
const mockCollection = vi.fn((...args: unknown[]) => args[1]);

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import { submitReport } from "../reports";

beforeEach(() => {
  vi.clearAllMocks();
});

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

    expect(id).toBe("report1");
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    const docData = mockAddDoc.mock.calls[0][1];
    expect(docData.reporterUid).toBe("user1");
    expect(docData.reportedUid).toBe("user2");
    expect(docData.reportedUsername).toBe("opponent");
    expect(docData.gameId).toBe("game1");
    expect(docData.reason).toBe("inappropriate_video");
    expect(docData.description).toBe("Offensive video content");
    expect(docData.status).toBe("pending");
    expect(docData.createdAt).toBe("SERVER_TS");
  });

  it("trims and caps description at 500 characters", async () => {
    const longDesc = "x".repeat(600) + "  ";
    await submitReport({ ...validParams, description: longDesc });

    const docData = mockAddDoc.mock.calls[0][1];
    expect(docData.description).toHaveLength(500);
  });

  it("throws if reason is empty", async () => {
    await expect(submitReport({ ...validParams, reason: "" as never })).rejects.toThrow("Please select a reason");
  });

  it("throws if reporter and reported are the same user", async () => {
    await expect(submitReport({ ...validParams, reportedUid: "user1" })).rejects.toThrow("You cannot report yourself");
  });

  it("throws a user-friendly message when addDoc fails", async () => {
    mockAddDoc.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(submitReport(validParams)).rejects.toThrow("Failed to submit report");
  });

  it("omits clipId by default (game-level report)", async () => {
    await submitReport(validParams);
    const docData = mockAddDoc.mock.calls[0][1];
    expect(docData).not.toHaveProperty("clipId");
  });

  it("writes clipId when reporting a specific feed clip", async () => {
    await submitReport({ ...validParams, clipId: "game1_3_match" });
    const docData = mockAddDoc.mock.calls[0][1];
    expect(docData.clipId).toBe("game1_3_match");
  });

  it("caps clipId at 128 characters (defense against rule boundary)", async () => {
    await submitReport({ ...validParams, clipId: "x".repeat(300) });
    const docData = mockAddDoc.mock.calls[0][1];
    expect(docData.clipId).toHaveLength(128);
  });

  it("drops an empty clipId rather than writing an empty string", async () => {
    await submitReport({ ...validParams, clipId: "" });
    const docData = mockAddDoc.mock.calls[0][1];
    expect(docData).not.toHaveProperty("clipId");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddDoc = vi.fn().mockResolvedValue({ id: "report1" });
const mockCollection = vi.fn((...args: unknown[]) => args[1]);
const mockGetDocs = vi.fn().mockResolvedValue({ empty: true });
const mockQuery = vi.fn((...args: unknown[]) => args);
const mockWhere = vi.fn((...args: unknown[]) => args);

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import { submitReport, hasReportedGame } from "../reports";

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
});

describe("hasReportedGame", () => {
  it("returns false when no existing report", async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true });
    const result = await hasReportedGame("user1", "game1");
    expect(result).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  it("returns true when a report already exists", async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: false });
    const result = await hasReportedGame("user1", "game1");
    expect(result).toBe(true);
  });

  it("returns false on Firestore error", async () => {
    mockGetDocs.mockRejectedValueOnce(new Error("Network error"));
    const result = await hasReportedGame("user1", "game1");
    expect(result).toBe(false);
  });
});

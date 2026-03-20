import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRunTransaction,
  mockOnSnapshot,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockLimit,
  mockTxGet,
  mockTxUpdate,
} = vi.hoisted(() => ({
  mockRunTransaction: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn((...args: any[]) => args.slice(1).join("/")),
  mockCollection: vi.fn((...args: any[]) => args[1]),
  mockQuery: vi.fn((...args: any[]) => args),
  mockWhere: vi.fn((...args: any[]) => args),
  mockLimit: vi.fn((...args: any[]) => args),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  runTransaction: mockRunTransaction,
  query: mockQuery,
  where: mockWhere,
  limit: mockLimit,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import { submitJuryVote, subscribeToOpenDisputes, subscribeToDispute } from "../disputes";

beforeEach(() => {
  vi.clearAllMocks();
  mockRunTransaction.mockImplementation(async (_db: unknown, cb: Function) => {
    const tx = { get: mockTxGet, update: mockTxUpdate };
    return cb(tx);
  });
});

function makeDisputeSnap(data: Record<string, unknown>, id = "d1") {
  return {
    exists: () => true,
    id,
    data: () => data,
  };
}

const baseDispute = {
  gameId: "g1",
  turnNumber: 1,
  trickName: "Kickflip",
  setterUid: "p1",
  matcherUid: "p2",
  setterUsername: "alice",
  matcherUsername: "bob",
  setVideoUrl: null,
  matchVideoUrl: null,
  setterVote: false,
  matcherVote: true,
  status: "open",
  resolution: null,
  juryVotes: {},
  jurySize: 0,
};

describe("disputes service", () => {
  describe("submitJuryVote", () => {
    it("adds a jury vote and increments count", async () => {
      mockTxGet.mockResolvedValueOnce(makeDisputeSnap(baseDispute));

      const result = await submitJuryVote("d1", "juror1", true);

      expect(result.resolved).toBe(false);
      expect(result.resolution).toBeNull();

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.juryVotes.juror1).toBe(true);
      expect(updates.jurySize).toBe(1);
      expect(updates.status).toBeUndefined(); // not resolved yet
    });

    it("resolves dispute when 3rd vote is cast (majority landed)", async () => {
      const dispute = {
        ...baseDispute,
        juryVotes: { juror1: true, juror2: false },
        jurySize: 2,
      };
      mockTxGet.mockResolvedValueOnce(makeDisputeSnap(dispute));

      const result = await submitJuryVote("d1", "juror3", true);

      expect(result.resolved).toBe(true);
      expect(result.resolution).toBe(true); // 2 landed vs 1 missed

      const updates = mockTxUpdate.mock.calls[0][1];
      expect(updates.status).toBe("resolved");
      expect(updates.resolution).toBe(true);
    });

    it("resolves dispute when 3rd vote is cast (majority missed)", async () => {
      const dispute = {
        ...baseDispute,
        juryVotes: { juror1: false, juror2: false },
        jurySize: 2,
      };
      mockTxGet.mockResolvedValueOnce(makeDisputeSnap(dispute));

      const result = await submitJuryVote("d1", "juror3", true);

      expect(result.resolved).toBe(true);
      expect(result.resolution).toBe(false); // 1 landed vs 2 missed
    });

    it("throws when dispute is already resolved", async () => {
      const dispute = { ...baseDispute, status: "resolved" };
      mockTxGet.mockResolvedValueOnce(makeDisputeSnap(dispute));

      await expect(submitJuryVote("d1", "juror1", true)).rejects.toThrow("Dispute is already resolved");
    });

    it("throws when a player tries to vote", async () => {
      mockTxGet.mockResolvedValueOnce(makeDisputeSnap(baseDispute));
      await expect(submitJuryVote("d1", "p1", true)).rejects.toThrow("Players cannot vote on their own dispute");
    });

    it("throws when juror already voted", async () => {
      const dispute = { ...baseDispute, juryVotes: { juror1: true }, jurySize: 1 };
      mockTxGet.mockResolvedValueOnce(makeDisputeSnap(dispute));

      await expect(submitJuryVote("d1", "juror1", false)).rejects.toThrow("You already voted on this dispute");
    });

    it("throws when dispute not found", async () => {
      mockTxGet.mockResolvedValueOnce({ exists: () => false });
      await expect(submitJuryVote("d1", "juror1", true)).rejects.toThrow("Dispute not found");
    });
  });

  describe("subscribeToOpenDisputes", () => {
    it("filters out disputes where current user is a player", () => {
      mockOnSnapshot.mockImplementation((_q: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "d1", data: () => ({ ...baseDispute, setterUid: "me", matcherUid: "p2" }) },
            { id: "d2", data: () => ({ ...baseDispute, setterUid: "p3", matcherUid: "p4" }) },
          ],
        });
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToOpenDisputes("me", onUpdate);

      const disputes = onUpdate.mock.calls[0][0];
      expect(disputes).toHaveLength(1);
      expect(disputes[0].id).toBe("d2");
    });

    it("filters out disputes where user already voted", () => {
      mockOnSnapshot.mockImplementation((_q: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "d1", data: () => ({ ...baseDispute, juryVotes: { me: true }, jurySize: 1 }) },
            { id: "d2", data: () => ({ ...baseDispute }) },
          ],
        });
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToOpenDisputes("me", onUpdate);

      const disputes = onUpdate.mock.calls[0][0];
      expect(disputes).toHaveLength(1);
      expect(disputes[0].id).toBe("d2");
    });

    it("returns unsubscribe function", () => {
      const unsub = vi.fn();
      mockOnSnapshot.mockReturnValue(unsub);

      const cleanup = subscribeToOpenDisputes("me", vi.fn());
      cleanup();
      expect(unsub).toHaveBeenCalled();
    });
  });

  describe("subscribeToDispute", () => {
    it("calls onUpdate with dispute doc", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, cb: Function) => {
        cb({
          exists: () => true,
          id: "d1",
          data: () => ({ ...baseDispute }),
        });
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToDispute("d1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    });

    it("calls onUpdate with null when dispute not found", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, cb: Function) => {
        cb({ exists: () => false });
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToDispute("d1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(null);
    });

    it("calls onUpdate with null on error", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, _onNext: unknown, onError: Function) => {
        onError(new Error("permission-denied"));
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToDispute("d1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(null);
    });
  });
});

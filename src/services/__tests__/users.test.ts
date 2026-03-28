import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockGetDoc,
  mockGetDocs,
  mockSetDoc,
  mockDeleteDoc,
  mockRunTransaction,
  mockWriteBatch,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockServerTimestamp,
  mockOrderBy,
  mockLimit,
} = vi.hoisted(() => {
  const batchInstance = { delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) };
  return {
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockSetDoc: vi.fn(),
    mockDeleteDoc: vi.fn(),
    mockRunTransaction: vi.fn(),
    mockWriteBatch: vi.fn(() => batchInstance),
    mockDoc: vi.fn((_db: unknown, ...pathSegments: string[]) => pathSegments.join("/")),
    mockCollection: vi.fn((_db: unknown, name: string) => name),
    mockQuery: vi.fn((...args: unknown[]) => args),
    mockWhere: vi.fn((...args: unknown[]) => args),
    mockServerTimestamp: vi.fn(() => "SERVER_TS"),
    mockOrderBy: vi.fn((...args: unknown[]) => args),
    mockLimit: vi.fn((...args: unknown[]) => args),
  };
});

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  deleteDoc: mockDeleteDoc,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  query: mockQuery,
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
  setDoc: mockSetDoc,
  runTransaction: mockRunTransaction,
  writeBatch: mockWriteBatch,
  serverTimestamp: () => mockServerTimestamp(),
}));

vi.mock("../../firebase");

const mockForfeitGameForDeletion = vi.fn().mockResolvedValue(undefined);
vi.mock("../games", () => ({
  forfeitGameForDeletion: (...args: unknown[]) => mockForfeitGameForDeletion(...args),
}));

import {
  getUserProfile,
  isUsernameAvailable,
  createProfile,
  getUidByUsername,
  deleteUserData,
  updatePlayerStats,
  getLeaderboard,
  getPlayerDirectory,
} from "../users";

beforeEach(() => vi.clearAllMocks());

/* ── Tests ──────────────────────────────────── */

describe("users service", () => {
  describe("getUserProfile", () => {
    it("returns profile data when document exists", async () => {
      const profile = { uid: "u1", email: "a@b.com", username: "sk8r" };
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
      const result = await getUserProfile("u1");
      expect(result).toEqual(profile);
    });

    it("returns null when document doesn't exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      const result = await getUserProfile("u1");
      expect(result).toBeNull();
    });
  });

  describe("isUsernameAvailable", () => {
    it("returns true when username doc does not exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      expect(await isUsernameAvailable("sk8r")).toBe(true);
    });

    it("returns false when username doc exists", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => true });
      expect(await isUsernameAvailable("sk8r")).toBe(false);
    });

    it("returns false for usernames shorter than 3 chars", async () => {
      expect(await isUsernameAvailable("ab")).toBe(false);
    });

    it("returns false for usernames longer than 20 chars", async () => {
      expect(await isUsernameAvailable("a".repeat(21))).toBe(false);
    });

    it("returns false for usernames with invalid characters", async () => {
      expect(await isUsernameAvailable("sk8r!")).toBe(false);
      expect(await isUsernameAvailable("no spaces")).toBe(false);
    });

    it("normalizes to lowercase", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      await isUsernameAvailable("SK8R");
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "usernames", "sk8r");
    });
  });

  describe("createProfile", () => {
    it("runs a transaction that reserves the username and creates the profile", async () => {
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => false }),
          set: vi.fn(),
        };
        return fn(tx);
      });

      const result = await createProfile("u1", "SK8R", "regular");
      expect(result).toMatchObject({
        uid: "u1",
        username: "sk8r",
        stance: "regular",
      });
      // email should not be stored in the profile (PII reduction)
      expect(result).not.toHaveProperty("email");
    });

    it("includes dob and parentalConsent when provided", async () => {
      let capturedProfile: Record<string, unknown> | undefined;
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => false }),
          set: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
            // Capture the profile data (second set call)
            if (data.uid) capturedProfile = data;
          }),
        };
        return fn(tx);
      });

      const result = await createProfile("u1", "sk8r", "regular", true, "2005-06-15", true);
      expect(result).toMatchObject({
        uid: "u1",
        username: "sk8r",
        stance: "regular",
        dob: "2005-06-15",
        parentalConsent: true,
      });
      expect(capturedProfile).toMatchObject({ dob: "2005-06-15", parentalConsent: true });
    });

    it("omits dob and parentalConsent when not provided", async () => {
      let capturedProfile: Record<string, unknown> | undefined;
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => false }),
          set: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
            if (data.uid) capturedProfile = data;
          }),
        };
        return fn(tx);
      });

      await createProfile("u1", "sk8r", "regular");
      expect(capturedProfile).not.toHaveProperty("dob");
      expect(capturedProfile).not.toHaveProperty("parentalConsent");
    });

    it("throws when username is too short", async () => {
      await expect(createProfile("u1", "ab", "regular")).rejects.toThrow("Username must be");
    });

    it("throws when username is too long", async () => {
      await expect(createProfile("u1", "a".repeat(21), "regular")).rejects.toThrow("Username must be");
    });

    it("throws when username has invalid characters", async () => {
      await expect(createProfile("u1", "sk8r!", "regular")).rejects.toThrow(
        "Username may only contain lowercase letters, numbers, and underscores",
      );
    });

    it("throws when username is already taken", async () => {
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => true }),
          set: vi.fn(),
        };
        return fn(tx);
      });

      await expect(createProfile("u1", "sk8r", "regular")).rejects.toThrow("Username is already taken");
    });
  });

  describe("deleteUserData", () => {
    it("forfeits active games, deletes all game docs, then profile and username via batch", async () => {
      const gameDoc1 = { id: "g1", data: () => ({ status: "active" }) };
      const gameDoc2 = { id: "g2", data: () => ({ status: "complete" }) };
      mockGetDocs
        .mockResolvedValueOnce({ docs: [gameDoc1] }) // player1Uid query
        .mockResolvedValueOnce({ docs: [gameDoc2] }); // player2Uid query
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      // Active game forfeited first
      expect(mockForfeitGameForDeletion).toHaveBeenCalledWith("g1", "u1");
      expect(mockForfeitGameForDeletion).toHaveBeenCalledTimes(1);
      // Both game docs deleted
      expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
      // Profile + username deleted via batch
      const batch = mockWriteBatch();
      expect(batch.delete).toHaveBeenCalledTimes(2);
      expect(batch.commit).toHaveBeenCalled();
    });

    it("deduplicates game docs appearing in both queries", async () => {
      const gameDoc = { id: "g1", data: () => ({ status: "complete" }) };
      mockGetDocs.mockResolvedValueOnce({ docs: [gameDoc] }).mockResolvedValueOnce({ docs: [gameDoc] }); // same game in both
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      // Only one deleteDoc call despite game appearing twice
      expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
      // No forfeits needed (game is complete)
      expect(mockForfeitGameForDeletion).not.toHaveBeenCalled();
    });

    it("treats games with missing status as non-active (no forfeit)", async () => {
      const gameDoc = { id: "g1", data: () => ({ player1Uid: "u1" }) }; // no status field
      mockGetDocs.mockResolvedValueOnce({ docs: [gameDoc] }).mockResolvedValueOnce({ docs: [] });
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      expect(mockForfeitGameForDeletion).not.toHaveBeenCalled();
      expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    });

    it("re-throws batch commit errors", async () => {
      // Phase 1 succeeds
      mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });

      // Phase 2 fails
      const batch = mockWriteBatch();
      batch.commit.mockRejectedValueOnce(new Error("Batch commit failed"));
      await expect(deleteUserData("u1", "sk8r")).rejects.toThrow("Batch commit failed");
    });
  });

  describe("getPlayerDirectory", () => {
    it("returns all user profiles ordered by createdAt desc", async () => {
      const profiles = [
        { uid: "u1", username: "sk8r1", stance: "regular" },
        { uid: "u2", username: "sk8r2", stance: "goofy" },
      ];
      mockGetDocs.mockResolvedValueOnce({
        docs: profiles.map((p) => ({ data: () => p })),
      });

      const result = await getPlayerDirectory();
      expect(result).toEqual(profiles);
      expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "users");
      expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
      expect(mockLimit).toHaveBeenCalledWith(100);
    });

    it("returns empty array when no users exist", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] });
      const result = await getPlayerDirectory();
      expect(result).toEqual([]);
    });
  });

  describe("getUidByUsername", () => {
    it("returns uid when username exists", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1" }),
      });
      expect(await getUidByUsername("sk8r")).toBe("u1");
    });

    it("returns null when username doesn't exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      expect(await getUidByUsername("sk8r")).toBeNull();
    });

    it("returns null when uid field is not a string", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: 12345 }),
      });
      expect(await getUidByUsername("sk8r")).toBeNull();
    });
  });

  describe("updatePlayerStats", () => {
    it("increments wins when player won", async () => {
      const mockTx = {
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ uid: "u1", username: "sk8r", wins: 3, losses: 1, lastStatsGameId: "old-game" }),
        }),
        update: vi.fn(),
      };
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => fn(mockTx));

      await updatePlayerStats("u1", "game-123", true);

      expect(mockTx.update).toHaveBeenCalledWith(expect.anything(), {
        wins: 4,
        lastStatsGameId: "game-123",
      });
    });

    it("increments losses when player lost", async () => {
      const mockTx = {
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ uid: "u1", username: "sk8r", wins: 2, losses: 5, lastStatsGameId: "old-game" }),
        }),
        update: vi.fn(),
      };
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => fn(mockTx));

      await updatePlayerStats("u1", "game-456", false);

      expect(mockTx.update).toHaveBeenCalledWith(expect.anything(), {
        losses: 6,
        lastStatsGameId: "game-456",
      });
    });

    it("defaults wins/losses to 0 when fields are missing", async () => {
      const mockTx = {
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ uid: "u1", username: "sk8r" }),
        }),
        update: vi.fn(),
      };
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => fn(mockTx));

      await updatePlayerStats("u1", "game-789", true);

      expect(mockTx.update).toHaveBeenCalledWith(expect.anything(), {
        wins: 1,
        lastStatsGameId: "game-789",
      });
    });

    it("skips update when lastStatsGameId matches (idempotency)", async () => {
      const mockTx = {
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          data: () => ({ uid: "u1", wins: 3, losses: 1, lastStatsGameId: "game-123" }),
        }),
        update: vi.fn(),
      };
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => fn(mockTx));

      await updatePlayerStats("u1", "game-123", true);

      expect(mockTx.update).not.toHaveBeenCalled();
    });

    it("skips update when profile does not exist", async () => {
      const mockTx = {
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        update: vi.fn(),
      };
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => fn(mockTx));

      await updatePlayerStats("u1", "game-123", true);

      expect(mockTx.update).not.toHaveBeenCalled();
    });
  });

  describe("getPlayerDirectory", () => {
    it("returns profiles sorted by createdAt desc", async () => {
      const profiles = [
        { uid: "u1", username: "alice", stance: "regular", createdAt: null, emailVerified: true },
        { uid: "u2", username: "bob", stance: "goofy", createdAt: null, emailVerified: true },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getPlayerDirectory();
      expect(result).toEqual(profiles);
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe("getLeaderboard", () => {
    it("returns profiles sorted by wins descending", async () => {
      const profiles = [
        { uid: "u1", username: "alice", wins: 2, losses: 1, createdAt: null, emailVerified: true, stance: "regular" },
        { uid: "u2", username: "bob", wins: 5, losses: 0, createdAt: null, emailVerified: true, stance: "goofy" },
        { uid: "u3", username: "charlie", wins: 2, losses: 3, createdAt: null, emailVerified: true, stance: "regular" },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getLeaderboard();

      expect(result[0].username).toBe("bob"); // 5 wins
      expect(result[1].username).toBe("alice"); // 2 wins, 66% rate
      expect(result[2].username).toBe("charlie"); // 2 wins, 40% rate
    });

    it("defaults missing wins/losses to 0 and sorts alphabetically as tiebreaker", async () => {
      const profiles = [
        { uid: "u1", username: "zorro", createdAt: null, emailVerified: true, stance: "regular" },
        { uid: "u2", username: "alice", createdAt: null, emailVerified: true, stance: "goofy" },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getLeaderboard();

      // Both have 0 wins, 0 losses, 0% rate — alphabetical
      expect(result[0].username).toBe("alice");
      expect(result[1].username).toBe("zorro");
    });
  });
});

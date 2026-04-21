import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockGetDoc,
  mockGetDocs,
  mockSetDoc,
  mockDeleteDoc,
  mockUpdateDoc,
  mockIncrement,
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
    mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
    mockIncrement: vi.fn((n: number) => ({ _op: "increment", operand: n })),
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
  updateDoc: mockUpdateDoc,
  increment: (n: number) => mockIncrement(n),
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

const mockDeleteGameVideos = vi.fn().mockResolvedValue(0);
vi.mock("../storage", () => ({
  deleteGameVideos: (...args: unknown[]) => mockDeleteGameVideos(...args),
}));

const mockDeleteUserClips = vi.fn().mockResolvedValue(undefined);
vi.mock("../clips", () => ({
  deleteUserClips: (...args: unknown[]) => mockDeleteUserClips(...args),
}));

import {
  getUserProfile,
  getUserPrivateProfile,
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

  describe("getUserPrivateProfile", () => {
    it("returns private profile data when document exists", async () => {
      const priv = { emailVerified: true, dob: "2000-01-15", fcmTokens: ["t1"] };
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => priv });
      const result = await getUserPrivateProfile("u1");
      expect(result).toEqual(priv);
      // Targets the owner-only subcollection path, not the public user doc.
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "u1", "private", "profile");
    });

    it("returns null when private document doesn't exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      const result = await getUserPrivateProfile("u1");
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
    const VALID_DOB = "2000-01-15";

    // Helper: run the create-profile transaction and capture the two
    // tx.set payloads we care about — the public users/{uid} doc
    // (identified by the presence of `uid`) and the private
    // users/{uid}/private/profile doc (identified by the presence of
    // `emailVerified`, which only lives on the private payload).
    function stubTransaction(): {
      capturedPublic: Record<string, unknown> | undefined;
      capturedPrivate: Record<string, unknown> | undefined;
    } {
      const captured: {
        capturedPublic: Record<string, unknown> | undefined;
        capturedPrivate: Record<string, unknown> | undefined;
      } = { capturedPublic: undefined, capturedPrivate: undefined };

      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => false }),
          set: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
            if (data.uid && data.username) captured.capturedPublic = data;
            else if ("emailVerified" in data) captured.capturedPrivate = data;
          }),
        };
        return fn(tx);
      });

      return captured;
    }

    it("runs a transaction that reserves the username and creates public + private docs", async () => {
      stubTransaction();

      const result = await createProfile("u1", "SK8R", "regular", false, VALID_DOB);
      expect(result).toMatchObject({
        uid: "u1",
        username: "sk8r",
        stance: "regular",
      });
      // Sensitive fields must NOT be on the public profile — they live on the
      // private doc per the public/private split that closed the cross-user
      // read leak (firestore.rules users/{uid} blocks these field names).
      expect(result).not.toHaveProperty("email");
      expect(result).not.toHaveProperty("emailVerified");
      expect(result).not.toHaveProperty("dob");
      expect(result).not.toHaveProperty("parentalConsent");
      expect(result).not.toHaveProperty("fcmTokens");
    });

    it("writes public doc without sensitive fields and private doc with emailVerified + dob", async () => {
      const captured = stubTransaction();

      await createProfile("u1", "sk8r", "regular", true, VALID_DOB);

      expect(captured.capturedPublic).toMatchObject({
        uid: "u1",
        username: "sk8r",
        stance: "regular",
      });
      // Public doc never carries sensitive fields.
      expect(captured.capturedPublic).not.toHaveProperty("emailVerified");
      expect(captured.capturedPublic).not.toHaveProperty("dob");
      expect(captured.capturedPublic).not.toHaveProperty("parentalConsent");
      expect(captured.capturedPublic).not.toHaveProperty("fcmTokens");
      expect(captured.capturedPublic).not.toHaveProperty("email");

      // Private doc carries emailVerified + dob.
      expect(captured.capturedPrivate).toMatchObject({ emailVerified: true, dob: VALID_DOB });
    });

    it("includes parentalConsent on the private doc when provided", async () => {
      const captured = stubTransaction();

      const result = await createProfile("u1", "sk8r", "regular", true, "2005-06-15", true);
      expect(result).toMatchObject({
        uid: "u1",
        username: "sk8r",
        stance: "regular",
      });
      expect(captured.capturedPrivate).toMatchObject({
        emailVerified: true,
        dob: "2005-06-15",
        parentalConsent: true,
      });
    });

    it("omits parentalConsent (but keeps dob) on the private doc when not provided", async () => {
      const captured = stubTransaction();

      await createProfile("u1", "sk8r", "regular", false, VALID_DOB);
      expect(captured.capturedPrivate).toHaveProperty("dob", VALID_DOB);
      expect(captured.capturedPrivate).toHaveProperty("emailVerified", false);
      expect(captured.capturedPrivate).not.toHaveProperty("parentalConsent");
    });

    it("throws AgeVerificationRequiredError when dob is missing (COPPA)", async () => {
      await expect(createProfile("u1", "sk8r", "regular")).rejects.toMatchObject({
        name: "AgeVerificationRequiredError",
      });
    });

    it("throws AgeVerificationRequiredError when dob is malformed", async () => {
      await expect(createProfile("u1", "sk8r", "regular", false, "not-a-date")).rejects.toMatchObject({
        name: "AgeVerificationRequiredError",
      });
      await expect(createProfile("u1", "sk8r", "regular", false, "2000/01/15")).rejects.toMatchObject({
        name: "AgeVerificationRequiredError",
      });
    });

    it("throws when username is too short", async () => {
      await expect(createProfile("u1", "ab", "regular", false, VALID_DOB)).rejects.toThrow("Username must be");
    });

    it("throws when username is too long", async () => {
      await expect(createProfile("u1", "a".repeat(21), "regular", false, VALID_DOB)).rejects.toThrow(
        "Username must be",
      );
    });

    it("throws when username has invalid characters", async () => {
      await expect(createProfile("u1", "sk8r!", "regular", false, VALID_DOB)).rejects.toThrow(
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

      await expect(createProfile("u1", "sk8r", "regular", false, VALID_DOB)).rejects.toThrow(
        "Username is already taken",
      );
    });
  });

  describe("deleteUserData", () => {
    it("deletes videos and game docs then profile and username via batch", async () => {
      const gameDoc1 = { id: "g1", data: () => ({ status: "complete" }) };
      const gameDoc2 = { id: "g2", data: () => ({ status: "forfeit" }) };
      mockGetDocs
        .mockResolvedValueOnce({ docs: [gameDoc1] }) // player1Uid query
        .mockResolvedValueOnce({ docs: [gameDoc2] }); // player2Uid query
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      // Videos deleted for each non-active game
      expect(mockDeleteGameVideos).toHaveBeenCalledWith("g1");
      expect(mockDeleteGameVideos).toHaveBeenCalledWith("g2");
      // Game docs deleted individually
      expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
      // Clips cascade invoked before the profile/username batch so the
      // owner-delete rule still has a valid auth context to match playerUid.
      expect(mockDeleteUserClips).toHaveBeenCalledWith("u1");
      // Profile + private profile doc + username deleted via batch.
      // Three deletes since the public/private split: the private
      // users/{uid}/private/profile doc holds the sensitive fields
      // (emailVerified, dob, fcmTokens, parentalConsent) and must be
      // scrubbed as part of the account-deletion cascade.
      const batch = mockWriteBatch();
      expect(batch.delete).toHaveBeenCalledTimes(3);
      expect(batch.commit).toHaveBeenCalled();
    });

    it("skips active games during deletion", async () => {
      const activeGame = { id: "g1", data: () => ({ status: "active" }) };
      const completeGame = { id: "g2", data: () => ({ status: "complete" }) };
      mockGetDocs.mockResolvedValueOnce({ docs: [activeGame, completeGame] }).mockResolvedValueOnce({ docs: [] });
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      // Only the complete game is deleted, not the active one
      expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
      expect(mockDeleteGameVideos).toHaveBeenCalledWith("g2");
      expect(mockDeleteGameVideos).not.toHaveBeenCalledWith("g1");
    });

    it("deduplicates game docs appearing in both queries", async () => {
      const gameDoc = { id: "g1", data: () => ({ status: "complete" }) };
      mockGetDocs.mockResolvedValueOnce({ docs: [gameDoc] }).mockResolvedValueOnce({ docs: [gameDoc] }); // same game in both
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      // Only one deleteDoc call despite game appearing twice
      expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
      expect(mockDeleteGameVideos).toHaveBeenCalledTimes(1);
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
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", username: "sk8r", wins: 3, losses: 1, lastStatsGameId: "old-game" }),
      });

      await updatePlayerStats("u1", "game-123", true);

      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
        wins: { _op: "increment", operand: 1 },
        lastStatsGameId: "game-123",
      });
    });

    it("increments losses when player lost", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", username: "sk8r", wins: 2, losses: 5, lastStatsGameId: "old-game" }),
      });

      await updatePlayerStats("u1", "game-456", false);

      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
        losses: { _op: "increment", operand: 1 },
        lastStatsGameId: "game-456",
      });
    });

    it("uses increment(1) regardless of whether field exists", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", username: "sk8r" }),
      });

      await updatePlayerStats("u1", "game-789", true);

      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
        wins: { _op: "increment", operand: 1 },
        lastStatsGameId: "game-789",
      });
    });

    it("skips update when lastStatsGameId matches (idempotency)", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", wins: 3, losses: 1, lastStatsGameId: "game-123" }),
      });

      await updatePlayerStats("u1", "game-123", true);

      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it("skips update when profile does not exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });

      await updatePlayerStats("u1", "game-123", true);

      expect(mockUpdateDoc).not.toHaveBeenCalled();
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

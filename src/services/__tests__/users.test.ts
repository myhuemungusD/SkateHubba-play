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

// Shared stand-in for requireAuth().currentUser so getUserProfileOnAuth can
// exercise its force-refresh / retry path. Individual tests swap in a fresh
// spy via `setMockCurrentUser` below to assert on getIdToken() calls.
const mockGetIdToken = vi.fn().mockResolvedValue("fresh-token");
let mockCurrentUser: { uid: string; getIdToken: typeof mockGetIdToken } | null = {
  uid: "u1",
  getIdToken: mockGetIdToken,
};
function setMockCurrentUser(user: { uid: string; getIdToken: typeof mockGetIdToken } | null) {
  mockCurrentUser = user;
}
vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
  requireAuth: () => ({
    get currentUser() {
      return mockCurrentUser;
    },
  }),
  requireStorage: () => ({}),
}));

/* ── mock firebase/storage (used by deleteUserData avatar cleanup) ─── */
const mockDeleteObject = vi.fn().mockResolvedValue(undefined);
const mockStorageRef = vi.fn((_storage: unknown, path: string) => ({ fullPath: path }));
vi.mock("firebase/storage", () => ({
  ref: (...args: unknown[]) => mockStorageRef(...(args as [unknown, string])),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

const mockDeleteGameVideos = vi.fn().mockResolvedValue(0);
vi.mock("../storage", () => ({
  deleteGameVideos: (...args: unknown[]) => mockDeleteGameVideos(...args),
}));

const mockDeleteUserClips = vi.fn().mockResolvedValue(undefined);
vi.mock("../clips", () => ({
  deleteUserClips: (...args: unknown[]) => mockDeleteUserClips(...args),
}));

const mockAccountDeleted = vi.fn();
vi.mock("../analytics", () => ({
  analytics: {
    accountDeleted: (...args: unknown[]) => mockAccountDeleted(...args),
  },
}));

const mockLoggerWarn = vi.fn();
vi.mock("../logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import {
  getUserProfile,
  getUserProfileOnAuth,
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

  describe("getUserProfileOnAuth", () => {
    beforeEach(() => {
      mockGetIdToken.mockClear();
      mockGetIdToken.mockResolvedValue("fresh-token");
      setMockCurrentUser({ uid: "u1", getIdToken: mockGetIdToken });
    });

    it("returns the profile on the happy path", async () => {
      const profile = { uid: "u1", username: "sk8r" };
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
      const result = await getUserProfileOnAuth("u1");
      expect(result).toEqual(profile);
      expect(mockGetIdToken).toHaveBeenCalledTimes(1);
    });

    it("falls back to plain getUserProfile when currentUser is missing", async () => {
      // No live auth context — the retry logic has nothing useful to do,
      // so we just hit the plain read path without touching getIdToken.
      setMockCurrentUser(null);
      const profile = { uid: "u1", username: "sk8r" };
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
      const result = await getUserProfileOnAuth("u1");
      expect(result).toEqual(profile);
      expect(mockGetIdToken).not.toHaveBeenCalled();
    });

    it("falls back to plain getUserProfile when currentUser uid mismatches", async () => {
      // Someone else signed in since the call was queued — retry protection
      // doesn't apply, but the caller still wants the profile.
      setMockCurrentUser({ uid: "someone-else", getIdToken: mockGetIdToken });
      const profile = { uid: "u1", username: "sk8r" };
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
      const result = await getUserProfileOnAuth("u1");
      expect(result).toEqual(profile);
      expect(mockGetIdToken).not.toHaveBeenCalled();
    });

    it("retries permission-denied and succeeds before the retry budget runs out", async () => {
      const profile = { uid: "u1", username: "sk8r" };
      // First call rejects with permission-denied (Firestore hasn't absorbed
      // the Auth token yet). Second call force-refreshes the token and
      // returns the profile.
      const permErr = Object.assign(new Error("permission-denied"), { code: "permission-denied" });
      mockGetDoc.mockRejectedValueOnce(permErr).mockResolvedValueOnce({ exists: () => true, data: () => profile });
      const result = await getUserProfileOnAuth("u1");
      expect(result).toEqual(profile);
      expect(mockGetDoc).toHaveBeenCalledTimes(2);
      // Second call should have force-refreshed the token (first call is
      // the cheap cached-token warmup).
      expect(mockGetIdToken).toHaveBeenNthCalledWith(2, true);
    }, 10_000);

    it("keeps retrying permission-denied across the full retry budget before giving up", async () => {
      const permErr = Object.assign(new Error("permission-denied"), { code: "permission-denied" });
      // 1 initial + 3 retries = 4 total attempts.
      mockGetDoc
        .mockRejectedValueOnce(permErr)
        .mockRejectedValueOnce(permErr)
        .mockRejectedValueOnce(permErr)
        .mockRejectedValueOnce(permErr);
      await expect(getUserProfileOnAuth("u1")).rejects.toBe(permErr);
      expect(mockGetDoc).toHaveBeenCalledTimes(4);
    }, 20_000);

    it("rethrows non-authz errors without a second attempt", async () => {
      const fatal = Object.assign(new Error("invalid-argument"), { code: "invalid-argument" });
      mockGetDoc.mockRejectedValueOnce(fatal);
      await expect(getUserProfileOnAuth("u1")).rejects.toBe(fatal);
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it("swallows a getIdToken failure and still attempts the read", async () => {
      mockGetIdToken.mockRejectedValueOnce(new Error("token_fetch_failed"));
      const profile = { uid: "u1", username: "sk8r" };
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
      const result = await getUserProfileOnAuth("u1");
      expect(result).toEqual(profile);
    });

    it("rethrows errors that expose no Firestore code at all (no retry)", async () => {
      // Bare Error (no `code` property) — once withRetry gives up, our
      // permission-denied branch mustn't match, so the caller sees the
      // original boom instead of a silent retry loop.
      mockGetDoc.mockRejectedValue(new Error("generic boom"));
      await expect(getUserProfileOnAuth("u1")).rejects.toThrow("generic boom");
    }, 10_000);

    it("bails out early when a retry surfaces a different non-authz error", async () => {
      const permErr = Object.assign(new Error("permission-denied"), { code: "permission-denied" });
      const fatal = Object.assign(new Error("failed-precondition"), { code: "failed-precondition" });
      mockGetDoc.mockRejectedValueOnce(permErr).mockRejectedValueOnce(fatal);
      await expect(getUserProfileOnAuth("u1")).rejects.toBe(fatal);
      expect(mockGetDoc).toHaveBeenCalledTimes(2);
    }, 10_000);

    it("bails out on a retry whose error exposes no code at all", async () => {
      // Coalesce branch: an uncoded retry error takes the same !== 'permission-denied'
      // path and should be rethrown rather than silently retried. withRetry
      // (inside getUserProfile) treats bare errors as transient, so all three
      // of its attempts need to reject with the same bare error before our
      // outer catch can see it.
      const permErr = Object.assign(new Error("permission-denied"), { code: "permission-denied" });
      const bare = new Error("unknown retry failure");
      mockGetDoc
        .mockRejectedValueOnce(permErr)
        .mockRejectedValueOnce(bare)
        .mockRejectedValueOnce(bare)
        .mockRejectedValueOnce(bare);
      await expect(getUserProfileOnAuth("u1")).rejects.toThrow("unknown retry failure");
    }, 15_000);
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
    /**
     * deleteUserData calls getDocs three times per invocation:
     *   1. games where player1Uid == uid
     *   2. games where player2Uid == uid
     *   3. users/{uid}/achievements subcollection (added in PR-Pre)
     * Tests that don't care about achievements stub it out as empty.
     */
    function stubEmptyAchievements(): void {
      mockGetDocs.mockResolvedValueOnce({ docs: [] }); // achievements
    }

    it("deletes videos and game docs then profile and username via batch", async () => {
      const gameDoc1 = { id: "g1", data: () => ({ status: "complete" }) };
      const gameDoc2 = { id: "g2", data: () => ({ status: "forfeit" }) };
      mockGetDocs
        .mockResolvedValueOnce({ docs: [gameDoc1] }) // player1Uid query
        .mockResolvedValueOnce({ docs: [gameDoc2] }); // player2Uid query
      stubEmptyAchievements();
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
      stubEmptyAchievements();
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
      stubEmptyAchievements();
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      // Only one deleteDoc call despite game appearing twice
      expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
      expect(mockDeleteGameVideos).toHaveBeenCalledTimes(1);
    });

    it("re-throws batch commit errors", async () => {
      // Phase 1 succeeds (games + achievements)
      mockGetDocs
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] }); // achievements

      // Phase 4 fails
      const batch = mockWriteBatch();
      batch.commit.mockRejectedValueOnce(new Error("Batch commit failed"));
      await expect(deleteUserData("u1", "sk8r")).rejects.toThrow("Batch commit failed");
    });

    it("folds the achievements subcollection into the profile/username batch", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
      const achievementRefs = [{ fullPath: "users/u1/achievements/a1" }, { fullPath: "users/u1/achievements/a2" }];
      mockGetDocs.mockResolvedValueOnce({
        docs: achievementRefs.map((ref) => ({ ref })),
      });
      mockDeleteDoc.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      // 2 achievements + private profile + public profile + username = 5 deletes.
      const batch = mockWriteBatch();
      expect(batch.delete).toHaveBeenCalledTimes(5);
      expect(batch.delete).toHaveBeenCalledWith(achievementRefs[0]);
      expect(batch.delete).toHaveBeenCalledWith(achievementRefs[1]);
      expect(batch.commit).toHaveBeenCalled();
    });

    it("attempts to delete all three avatar extensions from Storage", async () => {
      mockGetDocs
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] });
      mockDeleteObject.mockResolvedValue(undefined);

      await deleteUserData("u1", "sk8r");

      expect(mockStorageRef).toHaveBeenCalledWith(expect.anything(), "users/u1/avatar.webp");
      expect(mockStorageRef).toHaveBeenCalledWith(expect.anything(), "users/u1/avatar.jpeg");
      expect(mockStorageRef).toHaveBeenCalledWith(expect.anything(), "users/u1/avatar.png");
      expect(mockDeleteObject).toHaveBeenCalledTimes(3);
    });

    it("ignores 'object-not-found' avatar errors silently and still completes", async () => {
      mockGetDocs
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] });
      mockDeleteObject.mockReset();
      const notFound = Object.assign(new Error("not found"), { code: "storage/object-not-found" });
      mockDeleteObject.mockRejectedValue(notFound);

      await expect(deleteUserData("u1", "sk8r")).resolves.toBeUndefined();
      // 'not-found' is the expected case for users with no avatar — must not log.
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it("logs (but does not throw) on unexpected avatar delete failures", async () => {
      mockGetDocs
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] });
      mockDeleteObject.mockReset();
      mockDeleteObject.mockRejectedValue(Object.assign(new Error("boom"), { code: "storage/unauthenticated" }));

      await expect(deleteUserData("u1", "sk8r")).resolves.toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledWith("avatar_delete_failed", expect.objectContaining({ uid: "u1" }));
    });

    it("emits account_deleted telemetry with the achievements + avatar tally", async () => {
      mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
      const achievementRefs = [{ fullPath: "users/u1/achievements/a1" }];
      mockGetDocs.mockResolvedValueOnce({ docs: achievementRefs.map((ref) => ({ ref })) });
      mockDeleteObject.mockReset();
      // Two extensions present, one missing.
      mockDeleteObject.mockResolvedValueOnce(undefined);
      mockDeleteObject.mockRejectedValueOnce(Object.assign(new Error("nf"), { code: "storage/object-not-found" }));
      mockDeleteObject.mockResolvedValueOnce(undefined);

      await deleteUserData("u1", "sk8r");

      expect(mockAccountDeleted).toHaveBeenCalledWith("u1", 1, true);
    });

    it("reports avatarRemoved=false in telemetry when no avatar object existed", async () => {
      mockGetDocs
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] });
      mockDeleteObject.mockReset();
      mockDeleteObject.mockRejectedValue(Object.assign(new Error("nf"), { code: "storage/object-not-found" }));

      await deleteUserData("u1", "sk8r");

      expect(mockAccountDeleted).toHaveBeenCalledWith("u1", 0, false);
    });

    it("treats a non-Error avatar rejection as loggable (string error path)", async () => {
      mockGetDocs
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] });
      mockDeleteObject.mockReset();
      // Reject with a plain string — the logger fallback path stringifies it.
      mockDeleteObject.mockRejectedValue("string-error");

      await expect(deleteUserData("u1", "sk8r")).resolves.toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "avatar_delete_failed",
        expect.objectContaining({ error: "string-error" }),
      );
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
    /**
     * Drive a mock Firestore transaction: invoke the user callback with a tx
     * that reads the current user snapshot and captures the write payload.
     * Returns the captured update spy so tests can assert on it.
     */
    function runStubTx(snapshot: { exists: () => boolean; data: () => unknown }) {
      const txUpdate = vi.fn();
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue(snapshot),
          update: txUpdate,
        };
        return fn(tx);
      });
      return txUpdate;
    }

    it("increments wins inside a transaction when the player won", async () => {
      const txUpdate = runStubTx({
        exists: () => true,
        data: () => ({ uid: "u1", username: "sk8r", wins: 3, losses: 1, lastStatsGameId: "old-game" }),
      });

      await updatePlayerStats("u1", "game-123", true);

      expect(mockRunTransaction).toHaveBeenCalledTimes(1);
      expect(txUpdate).toHaveBeenCalledWith(expect.anything(), {
        wins: { _op: "increment", operand: 1 },
        lastStatsGameId: "game-123",
      });
      // Must NOT escape the transaction — the previous non-atomic
      // read-then-write path double-counted when two tabs raced.
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it("increments losses inside a transaction when the player lost", async () => {
      const txUpdate = runStubTx({
        exists: () => true,
        data: () => ({ uid: "u1", username: "sk8r", wins: 2, losses: 5, lastStatsGameId: "old-game" }),
      });

      await updatePlayerStats("u1", "game-456", false);

      expect(txUpdate).toHaveBeenCalledWith(expect.anything(), {
        losses: { _op: "increment", operand: 1 },
        lastStatsGameId: "game-456",
      });
    });

    it("uses increment(1) regardless of whether wins field exists", async () => {
      const txUpdate = runStubTx({
        exists: () => true,
        data: () => ({ uid: "u1", username: "sk8r" }),
      });

      await updatePlayerStats("u1", "game-789", true);

      expect(txUpdate).toHaveBeenCalledWith(expect.anything(), {
        wins: { _op: "increment", operand: 1 },
        lastStatsGameId: "game-789",
      });
    });

    it("skips the update when lastStatsGameId matches (idempotency re-checked inside tx)", async () => {
      const txUpdate = runStubTx({
        exists: () => true,
        data: () => ({ uid: "u1", wins: 3, losses: 1, lastStatsGameId: "game-123" }),
      });

      await updatePlayerStats("u1", "game-123", true);

      expect(mockRunTransaction).toHaveBeenCalledTimes(1);
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it("skips the update when the profile does not exist", async () => {
      const txUpdate = runStubTx({ exists: () => false, data: () => ({}) });

      await updatePlayerStats("u1", "game-123", true);

      expect(txUpdate).not.toHaveBeenCalled();
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

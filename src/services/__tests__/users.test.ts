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
const mockStatsCounterApplied = vi.fn();
const mockStatsCounterIdempotentSkip = vi.fn();
const mockStatsCounterSkippedFlagOff = vi.fn();
const mockStatsBackfillCompleted = vi.fn();
vi.mock("../analytics", () => ({
  analytics: {
    accountDeleted: (...args: unknown[]) => mockAccountDeleted(...args),
    statsCounterApplied: (...args: unknown[]) => mockStatsCounterApplied(...args),
    statsCounterIdempotentSkip: (...args: unknown[]) => mockStatsCounterIdempotentSkip(...args),
    statsCounterSkippedFlagOff: (...args: unknown[]) => mockStatsCounterSkippedFlagOff(...args),
    statsBackfillCompleted: (...args: unknown[]) => mockStatsBackfillCompleted(...args),
  },
}));

const mockLoggerWarn = vi.fn();
vi.mock("../logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

// PR-A1: feature-flag gating + Sentry breadcrumbs are exercised by the
// new applyGameOutcome / applyTrickLanded paths. Default the flag to ON
// so each test's positive paths run; flag-off cases override per test.
const mockIsFeatureEnabled = vi.fn((_flag: string, _defaultValue?: boolean): boolean => true);
vi.mock("../featureFlags", () => ({
  isFeatureEnabled: (flag: string, defaultValue?: boolean) => mockIsFeatureEnabled(flag, defaultValue),
}));

const mockAddBreadcrumb = vi.fn();
vi.mock("../../lib/sentry", () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

import {
  getUserProfile,
  getUserProfileOnAuth,
  isUsernameAvailable,
  createProfile,
  getUidByUsername,
  deleteUserData,
  applyGameOutcome,
  applyGameOutcomeStandalone,
  applyTrickLanded,
  backfillStatsIfNeeded,
  type GameOutcome,
  getLeaderboard,
  getPlayerDirectory,
  setProfileImageUrl,
  InvalidAvatarUrlError,
} from "../users";

beforeEach(() => vi.clearAllMocks());

/**
 * Build a minimal failing-tx whose `get` rejects with the given error.
 * Shared between applyGameOutcome / applyTrickLanded tests so the
 * permission-denied + non-Error throw setups stay collapsed under the
 * duplication-gate threshold.
 */
function makeFailingTx<T>(rejection: unknown): T {
  return {
    get: vi.fn().mockRejectedValue(rejection),
    update: vi.fn(),
  } as unknown as T;
}

/** Convenience: build a permission-denied error matching Firestore's shape. */
function makePermissionDeniedError(): Error & { code: string } {
  return Object.assign(new Error("permission-denied"), { code: "permission-denied" });
}

/**
 * Asserts (or refutes) that a `stats_rule_denied` Sentry breadcrumb was
 * recorded for the given uid/gameId/action. Shared by applyGameOutcome
 * and applyTrickLanded permission-denied tests so the duplication gate
 * stays clean.
 */
function expectStatsRuleDeniedBreadcrumb(opts: {
  uid: string;
  gameId: string;
  action: "apply_outcome" | "apply_trick";
  emitted: boolean;
}): void {
  const denyCrumb = mockAddBreadcrumb.mock.calls.find(
    ([crumb]) => (crumb as { message?: string }).message === "stats_rule_denied",
  );
  if (opts.emitted) {
    expect(denyCrumb).toBeDefined();
    expect(denyCrumb?.[0]).toMatchObject({
      category: "stats",
      level: "warning",
      data: { uid: opts.uid, gameId: opts.gameId, action: opts.action },
    });
  } else {
    expect(denyCrumb).toBeUndefined();
  }
}

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

  describe("applyGameOutcome", () => {
    /**
     * Build a fake Transaction object whose `get` resolves to `snapshot`
     * and whose `update` is captured. Returns the mock for assertions.
     * Each test passes its own snapshot so we can exercise idempotency
     * and the various result branches inline without touching
     * mockRunTransaction (the function is in-tx-only by contract).
     */
    function makeTx(snapshot: { exists: () => boolean; data: () => unknown }) {
      const update = vi.fn();
      const tx = {
        get: vi.fn().mockResolvedValue(snapshot),
        update,
      } as unknown as Parameters<typeof applyGameOutcome>[0];
      return { tx, update };
    }

    const baseOutcome: GameOutcome = {
      result: "win",
      tricksLandedThisGame: 0,
      cleanJudgmentEarned: false,
    };

    beforeEach(() => {
      mockIsFeatureEnabled.mockReturnValue(true);
    });

    it("win path increments gamesWon, currentWinStreak and bumps longestWinStreak", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({
          uid: "u1",
          gamesWon: 4,
          gamesLost: 2,
          gamesForfeited: 0,
          currentWinStreak: 2,
          longestWinStreak: 3,
        }),
      });

      const res = await applyGameOutcome(tx, "u1", "game-123", { ...baseOutcome, result: "win" }, 0);
      expect(res.stagedWrite).toBe(true);
      expect(update).toHaveBeenCalledWith(expect.anything(), {
        lastStatsGameId: "game-123",
        gamesWon: 5,
        currentWinStreak: 3,
        longestWinStreak: 3,
      });
    });

    it("win path raises longestWinStreak when current streak exceeds the previous max", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ currentWinStreak: 4, longestWinStreak: 4, gamesWon: 9 }),
      });

      await applyGameOutcome(tx, "u1", "game-7", { ...baseOutcome, result: "win" }, 0);
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect(updates.currentWinStreak).toBe(5);
      expect(updates.longestWinStreak).toBe(5);
    });

    it("win + cleanJudgmentEarned increments cleanJudgments", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ cleanJudgments: 2, gamesWon: 1, currentWinStreak: 0 }),
      });

      await applyGameOutcome(
        tx,
        "u1",
        "game-1",
        { result: "win", tricksLandedThisGame: 1, cleanJudgmentEarned: true },
        0,
      );
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect(updates.cleanJudgments).toBe(3);
    });

    it("win without cleanJudgmentEarned leaves cleanJudgments untouched", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ cleanJudgments: 5, gamesWon: 0 }),
      });

      await applyGameOutcome(
        tx,
        "u1",
        "game-2",
        { result: "win", tricksLandedThisGame: 0, cleanJudgmentEarned: false },
        0,
      );
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect("cleanJudgments" in updates).toBe(false);
    });

    it("loss path increments gamesLost and resets currentWinStreak", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ gamesLost: 1, currentWinStreak: 4, longestWinStreak: 4 }),
      });

      await applyGameOutcome(tx, "u1", "game-X", { ...baseOutcome, result: "loss" }, 0);
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect(updates.gamesLost).toBe(2);
      expect(updates.currentWinStreak).toBe(0);
      // longestWinStreak must NOT be touched on a loss — would zero the
      // proudest stat on the profile. (Plan §3.1.1.)
      expect("longestWinStreak" in updates).toBe(false);
    });

    it("forfeit path increments gamesForfeited and resets currentWinStreak (plan §3.1.2)", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ gamesForfeited: 0, currentWinStreak: 7, longestWinStreak: 7 }),
      });

      await applyGameOutcome(tx, "u1", "game-Y", { ...baseOutcome, result: "forfeit" }, 0);
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect(updates.gamesForfeited).toBe(1);
      expect(updates.currentWinStreak).toBe(0);
      expect("longestWinStreak" in updates).toBe(false);
    });

    it("idempotent — same gameId is a silent no-op and emits the dedup event", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ lastStatsGameId: "game-123", gamesWon: 5 }),
      });

      const res = await applyGameOutcome(tx, "u1", "game-123", baseOutcome, 0);
      expect(res.stagedWrite).toBe(false);
      expect(update).not.toHaveBeenCalled();
      expect(mockStatsCounterIdempotentSkip).toHaveBeenCalledWith("u1", "game-123");
    });

    it("flag off — early returns without reading the user doc", async () => {
      mockIsFeatureEnabled.mockReturnValueOnce(false);
      const { tx, update } = makeTx({ exists: () => true, data: () => ({}) });

      const res = await applyGameOutcome(tx, "u1", "game-3", baseOutcome, 0);
      expect(res.stagedWrite).toBe(false);
      expect(update).not.toHaveBeenCalled();
      expect(mockStatsCounterSkippedFlagOff).toHaveBeenCalledWith("u1");
    });

    it("emits stats_counter_applied with the result + tricks + clean shape", async () => {
      const { tx } = makeTx({
        exists: () => true,
        data: () => ({ gamesWon: 0, currentWinStreak: 0, longestWinStreak: 0 }),
      });

      await applyGameOutcome(
        tx,
        "u1",
        "game-T",
        { result: "win", tricksLandedThisGame: 4, cleanJudgmentEarned: true },
        0,
      );
      expect(mockStatsCounterApplied).toHaveBeenCalledWith(
        "u1",
        "game-T",
        "win",
        4,
        true,
        expect.any(Number),
      );
    });

    it("treats a missing profile snapshot as zero counters", async () => {
      const { tx, update } = makeTx({ exists: () => false, data: () => ({}) });

      const res = await applyGameOutcome(tx, "u1", "game-Z", { ...baseOutcome, result: "win" }, 0);
      expect(res.stagedWrite).toBe(true);
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect(updates.gamesWon).toBe(1);
      expect(updates.currentWinStreak).toBe(1);
      expect(updates.longestWinStreak).toBe(1);
    });

    it("xpDelta > 0 stages xp and level (placeholder until PR-E)", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ xp: 50, level: 1, gamesWon: 0, currentWinStreak: 0 }),
      });

      await applyGameOutcome(tx, "u1", "game-X1", baseOutcome, 100);
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect(updates.xp).toBe(150);
      expect(updates.level).toBe(1);
    });

    it("xpDelta caps xp at 12000", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ xp: 11_950, gamesWon: 0, currentWinStreak: 0 }),
      });

      await applyGameOutcome(tx, "u1", "game-cap", baseOutcome, 200);
      const updates = update.mock.calls[0][1] as Record<string, unknown>;
      expect(updates.xp).toBe(12_000);
    });

    it("propagates a tx.get failure as an error and emits an error breadcrumb", async () => {
      const failingTx = {
        get: vi.fn().mockRejectedValue(new Error("permission-denied")),
        update: vi.fn(),
      } as unknown as Parameters<typeof applyGameOutcome>[0];

      await expect(applyGameOutcome(failingTx, "u1", "game-err", baseOutcome, 0)).rejects.toThrow("permission-denied");
      const errorCrumb = mockAddBreadcrumb.mock.calls.find(
        ([crumb]) => (crumb as { message?: string }).message === "applyGameOutcome.error",
      );
      expect(errorCrumb).toBeDefined();
    });

    it("emits stats_rule_denied breadcrumb when the rule rejects with permission-denied", async () => {
      const permErr = makePermissionDeniedError();
      const failingTx = makeFailingTx<Parameters<typeof applyGameOutcome>[0]>(permErr);

      await expect(applyGameOutcome(failingTx, "u1", "game-rule", baseOutcome, 0)).rejects.toBe(permErr);
      expectStatsRuleDeniedBreadcrumb({
        uid: "u1",
        gameId: "game-rule",
        action: "apply_outcome",
        emitted: true,
      });
    });

    it("does NOT emit stats_rule_denied for non-permission-denied errors", async () => {
      const failingTx = makeFailingTx<Parameters<typeof applyGameOutcome>[0]>(new Error("network"));

      await expect(applyGameOutcome(failingTx, "u1", "game-net", baseOutcome, 0)).rejects.toThrow("network");
      expectStatsRuleDeniedBreadcrumb({
        uid: "u1",
        gameId: "game-net",
        action: "apply_outcome",
        emitted: false,
      });
    });

    it("falls back to String(err) when a non-Error value is thrown", async () => {
      // Defensive path — Firestore SDK always rejects with Error, but the
      // breadcrumb data field guards against a malformed mock surfacing.
      const failingTx = {
        get: vi.fn().mockRejectedValue("string-error-not-an-Error"),
        update: vi.fn(),
      } as unknown as Parameters<typeof applyGameOutcome>[0];

      await expect(applyGameOutcome(failingTx, "u1", "g", baseOutcome, 0)).rejects.toBe("string-error-not-an-Error");
    });
  });

  describe("applyTrickLanded", () => {
    function makeTx(snapshot: { exists: () => boolean; data: () => unknown }) {
      const update = vi.fn();
      const tx = {
        get: vi.fn().mockResolvedValue(snapshot),
        update,
      } as unknown as Parameters<typeof applyTrickLanded>[0];
      return { tx, update };
    }

    beforeEach(() => mockIsFeatureEnabled.mockReturnValue(true));

    it("stages a +1 increment when under the per-game cap", async () => {
      const { tx, update } = makeTx({
        exists: () => true,
        data: () => ({ tricksLandedThisGame: 0, tricksLanded: 12 }),
      });

      const res = await applyTrickLanded(tx, "u1", "game-1");
      expect(res.stagedWrite).toBe(true);
      expect(update).toHaveBeenCalledWith(expect.anything(), {
        tricksLanded: { _op: "increment", operand: 1 },
        tricksLandedThisGame: { _op: "increment", operand: 1 },
      });
    });

    it("allows the 6th increment but refuses the 7th and 8th (per-game cap, plan §3.1.3)", async () => {
      const fixtures = [
        { perGame: 5, expected: true }, // 6th: still allowed
        { perGame: 6, expected: false }, // 7th: blocked
        { perGame: 7, expected: false }, // 8th: blocked
      ];
      for (const { perGame, expected } of fixtures) {
        const { tx, update } = makeTx({
          exists: () => true,
          data: () => ({ tricksLandedThisGame: perGame }),
        });
        const res = await applyTrickLanded(tx, "u1", "game-cap");
        expect(res.stagedWrite).toBe(expected);
        if (expected) expect(update).toHaveBeenCalledTimes(1);
        else expect(update).not.toHaveBeenCalled();
      }
    });

    it("flag off — no read, no write", async () => {
      mockIsFeatureEnabled.mockReturnValueOnce(false);
      const { tx, update } = makeTx({ exists: () => true, data: () => ({}) });

      const res = await applyTrickLanded(tx, "u1", "game-foo");
      expect(res.stagedWrite).toBe(false);
      expect(update).not.toHaveBeenCalled();
      expect(mockStatsCounterSkippedFlagOff).toHaveBeenCalledWith("u1");
    });

    it("treats missing profile as 0/game and stages the increment", async () => {
      const { tx, update } = makeTx({ exists: () => false, data: () => ({}) });

      const res = await applyTrickLanded(tx, "u1", "game-2");
      expect(res.stagedWrite).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("propagates tx.get failure as an error and breadcrumbs", async () => {
      const failingTx = {
        get: vi.fn().mockRejectedValue(new Error("network")),
        update: vi.fn(),
      } as unknown as Parameters<typeof applyTrickLanded>[0];

      await expect(applyTrickLanded(failingTx, "u1", "game-err")).rejects.toThrow("network");
      const errorCrumb = mockAddBreadcrumb.mock.calls.find(
        ([crumb]) => (crumb as { message?: string }).message === "applyTrickLanded.error",
      );
      expect(errorCrumb).toBeDefined();
    });

    it("emits stats_rule_denied breadcrumb when the rule rejects with permission-denied", async () => {
      const permErr = makePermissionDeniedError();
      const failingTx = makeFailingTx<Parameters<typeof applyTrickLanded>[0]>(permErr);

      await expect(applyTrickLanded(failingTx, "u1", "game-rule")).rejects.toBe(permErr);
      expectStatsRuleDeniedBreadcrumb({
        uid: "u1",
        gameId: "game-rule",
        action: "apply_trick",
        emitted: true,
      });
    });

    it("does NOT emit stats_rule_denied for non-permission-denied errors", async () => {
      const failingTx = makeFailingTx<Parameters<typeof applyTrickLanded>[0]>(new Error("network"));

      await expect(applyTrickLanded(failingTx, "u1", "game-net")).rejects.toThrow("network");
      expectStatsRuleDeniedBreadcrumb({
        uid: "u1",
        gameId: "game-net",
        action: "apply_trick",
        emitted: false,
      });
    });

    it("falls back to String(err) when a non-Error value is thrown", async () => {
      const failingTx = {
        get: vi.fn().mockRejectedValue("network-err-as-string"),
        update: vi.fn(),
      } as unknown as Parameters<typeof applyTrickLanded>[0];

      await expect(applyTrickLanded(failingTx, "u1", "g")).rejects.toBe("network-err-as-string");
    });
  });

  describe("applyGameOutcomeStandalone", () => {
    beforeEach(() => mockIsFeatureEnabled.mockReturnValue(true));

    it("opens its own runTransaction and forwards the tx into applyGameOutcome", async () => {
      const txUpdate = vi.fn();
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({
            exists: () => true,
            data: () => ({ gamesWon: 0, currentWinStreak: 0 }),
          }),
          update: txUpdate,
        };
        return fn(tx);
      });

      const res = await applyGameOutcomeStandalone(
        "u1",
        "game-A",
        { result: "win", tricksLandedThisGame: 0, cleanJudgmentEarned: false },
        0,
      );
      expect(res.stagedWrite).toBe(true);
      expect(mockRunTransaction).toHaveBeenCalledTimes(1);
      expect(txUpdate).toHaveBeenCalledTimes(1);
    });

    it("returns stagedWrite=false when the flag is off (no transaction body work)", async () => {
      mockIsFeatureEnabled.mockReturnValueOnce(false);
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
          update: vi.fn(),
        };
        return fn(tx);
      });

      const res = await applyGameOutcomeStandalone(
        "u1",
        "g",
        { result: "win", tricksLandedThisGame: 0, cleanJudgmentEarned: false },
        0,
      );
      expect(res.stagedWrite).toBe(false);
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

  /* ── setProfileImageUrl ─────────────────────── */
  describe("setProfileImageUrl", () => {
    const BUCKET = "test-bucket.firebasestorage.app";
    const validUrl = (uid: string, ext = "webp"): string =>
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/users%2F${uid}%2Favatar.${ext}?alt=media&token=abc`;

    beforeEach(() => {
      vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", BUCKET);
      // Default tx implementation: profile exists, update applies cleanly.
      mockRunTransaction.mockImplementation(
        async (_db: unknown, fn: (tx: { get: typeof vi.fn; update: typeof vi.fn }) => unknown) => {
          const tx = {
            get: vi.fn().mockResolvedValue({ exists: () => true }),
            update: vi.fn(),
          };
          return await fn(tx as never);
        },
      );
    });

    it("writes the URL when it matches the bucket+UID pattern", async () => {
      await expect(setProfileImageUrl("u1", validUrl("u1"))).resolves.toBeUndefined();
      expect(mockRunTransaction).toHaveBeenCalled();
    });

    it("accepts null to clear the avatar", async () => {
      await expect(setProfileImageUrl("u1", null)).resolves.toBeUndefined();
    });

    it("rejects URLs targeting another user's UID (audit S12)", async () => {
      await expect(setProfileImageUrl("u1", validUrl("u2"))).rejects.toBeInstanceOf(InvalidAvatarUrlError);
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it("rejects URLs pointing at a non-project bucket (audit S5)", async () => {
      await expect(
        setProfileImageUrl(
          "u1",
          `https://firebasestorage.googleapis.com/v0/b/evil.firebasestorage.app/o/users%2Fu1%2Favatar.webp`,
        ),
      ).rejects.toBeInstanceOf(InvalidAvatarUrlError);
    });

    it("rejects malformed URLs", async () => {
      await expect(setProfileImageUrl("u1", "not-a-url")).rejects.toBeInstanceOf(InvalidAvatarUrlError);
    });

    it("rejects extensions outside the allowlist", async () => {
      await expect(setProfileImageUrl("u1", validUrl("u1", "gif"))).rejects.toBeInstanceOf(InvalidAvatarUrlError);
    });

    it("throws when the profile does not exist", async () => {
      mockRunTransaction.mockImplementation(
        async (_db: unknown, fn: (tx: { get: typeof vi.fn; update: typeof vi.fn }) => unknown) => {
          const tx = {
            get: vi.fn().mockResolvedValue({ exists: () => false }),
            update: vi.fn(),
          };
          return await fn(tx as never);
        },
      );
      await expect(setProfileImageUrl("u1", validUrl("u1"))).rejects.toThrow("avatar_profile_not_found");
    });
  });

  /* ──────────────────────────────────────────────────────────────────
   * PR-A2: backfillStatsIfNeeded
   *
   * Each test isolates one branch of the function: flag-off short
   * circuit, already-backfilled short circuit, missing profile short
   * circuit, the happy path with counter math, the partial-cap branch,
   * the suspicious-deltas Sentry breadcrumbs, and the error path.
   * Coverage target: 100% on lines, branches, statements, functions
   * — matches the services/** floor in vitest.config.ts.
   * ────────────────────────────────────────────────────────────────── */
  describe("backfillStatsIfNeeded", () => {
    /**
     * Build a games doc shape that the backfill compute helper will
     * recognise. Only the fields the function reads are populated.
     */
    function gameDoc(overrides: Record<string, unknown>): { id: string; data: () => Record<string, unknown> } {
      const id = String(overrides.id ?? `g-${Math.random().toString(36).slice(2)}`);
      const data: Record<string, unknown> = {
        status: "complete",
        winner: null,
        player1Uid: "u1",
        player2Uid: "u2",
        updatedAt: { toMillis: () => Number(overrides.ageMs ?? 0) },
        turnHistory: [],
        ...overrides,
      };
      delete data.ageMs;
      return { id, data: () => data };
    }

    /** Build N synthetic "u1 won as player1" games for size-driven tests. */
    function buildWinDocs(count: number) {
      return Array.from({ length: count }, (_, i) =>
        gameDoc({ id: `g${i}`, winner: "u1", ageMs: i }),
      );
    }

    /** Stub runTransaction to invoke its callback with a no-op tx. */
    function stubTx(updateSpy: (...args: unknown[]) => unknown = () => undefined) {
      mockRunTransaction.mockImplementationOnce(
        async (_db: unknown, fn: (tx: { update: typeof updateSpy }) => Promise<void>) => {
          await fn({ update: updateSpy });
        },
      );
    }

    it("no-ops when feature flag is OFF", async () => {
      mockIsFeatureEnabled.mockReturnValueOnce(false);
      const result = await backfillStatsIfNeeded("u1");
      expect(result).toEqual({ backfilled: false, partial: false });
      expect(mockGetDoc).not.toHaveBeenCalled();
      expect(mockRunTransaction).not.toHaveBeenCalled();
      expect(mockStatsBackfillCompleted).not.toHaveBeenCalled();
    });

    it("no-ops when statsBackfilledAt is already set", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", statsBackfilledAt: { seconds: 1, nanoseconds: 0 } }),
      });
      const result = await backfillStatsIfNeeded("u1");
      expect(result).toEqual({ backfilled: false, partial: false });
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it("no-ops when profile doc does not exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => ({}) });
      const result = await backfillStatsIfNeeded("u1");
      expect(result).toEqual({ backfilled: false, partial: false });
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it("happy path: computes counters across wins / losses / forfeits and writes inside a transaction", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", statsBackfilledAt: null }),
      });
      // Two queries (player1Uid, player2Uid) — each resolves to a list
      // of completed games. Mix of win, loss, forfeit-loser, forfeit-winner
      // exercises every branch in computeBackfillCounters.
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          // Win with one landed turn for u1 as matcher.
          gameDoc({
            id: "g1",
            status: "complete",
            winner: "u1",
            player1Uid: "u1",
            player2Uid: "u2",
            ageMs: 1,
            turnHistory: [
              { landed: true, matcherUid: "u1" },
              { landed: false, matcherUid: "u1" },
              { landed: true, matcherUid: "u2" }, // doesn't credit u1
            ],
          }),
          // Loss — streak resets; tricksLanded credit only counts u1's
          // matched-and-landed turns, of which there is one here.
          gameDoc({
            id: "g2",
            status: "complete",
            winner: "u2",
            player1Uid: "u1",
            player2Uid: "u2",
            ageMs: 2,
            turnHistory: [{ landed: true, matcherUid: "u1" }],
          }),
        ],
      });
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          // Forfeit win (opponent forfeited) — streak picks back up.
          gameDoc({
            id: "g3",
            status: "forfeit",
            winner: "u1",
            player1Uid: "u2",
            player2Uid: "u1",
            ageMs: 3,
          }),
          // Forfeit loss (u1 forfeited) — gamesForfeited++, streak resets.
          gameDoc({
            id: "g4",
            status: "forfeit",
            winner: "u2",
            player1Uid: "u1",
            player2Uid: "u2",
            ageMs: 4,
          }),
          // Last entry is a win — current streak = 1 at the end.
          gameDoc({
            id: "g5",
            status: "complete",
            winner: "u1",
            player1Uid: "u1",
            player2Uid: "u2",
            ageMs: 5,
            // turnHistory missing → exercises the array-guard branch.
          }),
        ],
      });
      const updateSpy = vi.fn();
      mockRunTransaction.mockImplementationOnce(
        async (_db: unknown, fn: (tx: { update: typeof updateSpy }) => Promise<void>) => {
          await fn({ update: updateSpy });
        },
      );

      const result = await backfillStatsIfNeeded("u1");

      expect(result).toEqual({ backfilled: true, partial: false });
      expect(updateSpy).toHaveBeenCalledTimes(1);
      const writePayload = updateSpy.mock.calls[0][1] as Record<string, unknown>;
      // 3 wins (g1, g3, g5), 1 loss (g2), 1 forfeit (g4), 2 tricks for u1.
      expect(writePayload).toMatchObject({
        gamesWon: 3,
        gamesLost: 1,
        gamesForfeited: 1,
        tricksLanded: 2,
        // After chronological walk: g1 win(1), g2 loss(0), g3 win(1), g4 forfeit(0), g5 win(1).
        currentWinStreak: 1,
        longestWinStreak: 1,
        cleanJudgments: 0,
      });
      expect(mockStatsBackfillCompleted).toHaveBeenCalledTimes(1);
    });

    it("flags partial when 1000-game safety cap is hit", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", statsBackfilledAt: null }),
      });
      mockGetDocs.mockResolvedValueOnce({ docs: buildWinDocs(1000) });
      mockGetDocs.mockResolvedValueOnce({ docs: [] });
      stubTx();

      const result = await backfillStatsIfNeeded("u1");

      expect(result).toEqual({ backfilled: true, partial: true });
      expect(mockStatsBackfillCompleted).toHaveBeenCalledWith(
        "u1",
        1000, // gamesWon
        0,
        0,
        0,
        1000, // gamesSeen
        expect.any(Number),
        true,
      );
    });

    it("emits suspicious-delta breadcrumbs when gamesWon > 100", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", statsBackfilledAt: null }),
      });
      // 101 wins → triggers both the gamesWon and the level-proxy
      // breadcrumbs (101/4 = 25.25 > 15).
      mockGetDocs.mockResolvedValueOnce({ docs: buildWinDocs(101) });
      mockGetDocs.mockResolvedValueOnce({ docs: [] });
      stubTx();

      const result = await backfillStatsIfNeeded("u1");

      expect(result.backfilled).toBe(true);
      const suspiciousCalls = mockAddBreadcrumb.mock.calls
        .map((c) => c[0] as { message?: string })
        .filter((c) => c.message === "stats_backfill_suspicious");
      expect(suspiciousCalls.length).toBe(2); // gamesWon reason + level-proxy reason
    });

    it("tolerates legacy game shapes with missing/non-string fields", async () => {
      // Coverage closer for the defensive branches in the compute
      // helper: non-string status, missing updatedAt sort key, missing
      // turnHistory, and turnHistory entries with non-conforming
      // shapes (no landed flag, wrong matcherUid, primitive entries).
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", statsBackfilledAt: null }),
      });
      const legacyDocs = [
        // status missing entirely → typeof !== "string" branch.
        // updatedAt missing → exercises the ?. fallback in the sort
        // comparator. Pairing this with legacy-2 (which has updatedAt)
        // forces the comparator to actually run on two distinct shapes.
        {
          id: "legacy-1",
          data: () => ({
            winner: "u1",
            player1Uid: "u1",
            player2Uid: "u2",
          }),
        },
        // turnHistory present but with garbage entries → inner-`if` branches.
        {
          id: "legacy-2",
          data: () => ({
            status: "complete",
            winner: "u2",
            player1Uid: "u1",
            player2Uid: "u2",
            updatedAt: { toMillis: () => 7 },
            turnHistory: [
              null,
              "not-an-object",
              { landed: false, matcherUid: "u1" },
              { landed: true, matcherUid: "u2" }, // wrong matcher
              { landed: true, matcherUid: "u1" },
            ],
          }),
        },
        // updatedAt present but as a plain object missing toMillis —
        // exercises the inner `?.` short-circuit on the function call.
        {
          id: "legacy-3",
          data: () => ({
            status: "complete",
            winner: "u1",
            player1Uid: "u1",
            player2Uid: "u2",
            updatedAt: {} as { toMillis?: () => number },
          }),
        },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: legacyDocs });
      mockGetDocs.mockResolvedValueOnce({ docs: [] });
      const updateSpy = vi.fn();
      mockRunTransaction.mockImplementationOnce(
        async (_db: unknown, fn: (tx: { update: typeof updateSpy }) => Promise<void>) => {
          await fn({ update: updateSpy });
        },
      );

      await backfillStatsIfNeeded("u1");

      const writePayload = updateSpy.mock.calls[0][1] as Record<string, number>;
      // legacy-1 → status missing → won (winner == u1) → +1 win.
      // legacy-2 → loss; one valid matched-and-landed entry → +1 trick.
      // legacy-3 → won (winner == u1) → +1 win.
      expect(writePayload.gamesWon).toBe(2);
      expect(writePayload.gamesLost).toBe(1);
      expect(writePayload.gamesForfeited).toBe(0);
      expect(writePayload.tricksLanded).toBe(1);
    });

    it("dedupes games returned by both player1Uid and player2Uid queries", async () => {
      // Edge case: a single game is matched on both queries when the
      // user appears in either field (Firestore can return a duplicate
      // doc once per query). The Map-based dedup keeps only one copy.
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", statsBackfilledAt: null }),
      });
      const sameGame = gameDoc({
        id: "g-dup",
        status: "complete",
        winner: "u1",
        player1Uid: "u1",
        player2Uid: "u2",
        ageMs: 1,
      });
      mockGetDocs.mockResolvedValueOnce({ docs: [sameGame] });
      mockGetDocs.mockResolvedValueOnce({ docs: [sameGame] });
      const updateSpy = vi.fn();
      mockRunTransaction.mockImplementationOnce(
        async (_db: unknown, fn: (tx: { update: typeof updateSpy }) => Promise<void>) => {
          await fn({ update: updateSpy });
        },
      );

      await backfillStatsIfNeeded("u1");

      // gamesWon must be exactly 1 — if dedup were broken it would be 2.
      expect((updateSpy.mock.calls[0][1] as { gamesWon: number }).gamesWon).toBe(1);
    });

    it("propagates errors with a Sentry breadcrumb", async () => {
      mockGetDoc.mockRejectedValueOnce(new Error("boom"));
      await expect(backfillStatsIfNeeded("u1")).rejects.toThrow("boom");
      const errorCrumb = mockAddBreadcrumb.mock.calls
        .map((c) => c[0] as { message?: string; level?: string })
        .find((c) => c.message === "backfillStatsIfNeeded.error");
      expect(errorCrumb?.level).toBe("error");
    });

    it("non-Error throws are coerced to a string in the breadcrumb (post-getDoc path)", async () => {
      // Mirrors the defensive String() fallback in applyGameOutcome's
      // catch block. We trigger a non-Error throw from runTransaction so
      // we bypass withRetry's optimistic-retry branch on the initial
      // getDoc call (string throws are otherwise retried 3× by retry.ts).
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1", statsBackfilledAt: null }),
      });
      mockGetDocs.mockResolvedValueOnce({ docs: [] });
      mockGetDocs.mockResolvedValueOnce({ docs: [] });
      mockRunTransaction.mockImplementationOnce(() => Promise.reject("non-error-throw"));
      await expect(backfillStatsIfNeeded("u1")).rejects.toBe("non-error-throw");
      const errorCrumb = mockAddBreadcrumb.mock.calls
        .map((c) => c[0] as { message?: string; data?: { error?: string } })
        .find((c) => c.message === "backfillStatsIfNeeded.error");
      expect(errorCrumb?.data?.error).toBe("non-error-throw");
    });
  });
});

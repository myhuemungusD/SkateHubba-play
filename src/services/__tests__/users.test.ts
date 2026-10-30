import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockGetDoc,
  mockGetDocs,
  mockSetDoc,
  mockUpdateDoc,
  mockIncrement,
  mockRunTransaction,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockServerTimestamp,
  mockOrderBy,
  mockLimit,
} = vi.hoisted(() => {
  return {
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockSetDoc: vi.fn(),
    mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
    mockIncrement: vi.fn((n: number) => ({ _op: "increment", operand: n })),
    mockRunTransaction: vi.fn(),
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
  getLeaderboard,
  getPlayerDirectory,
  setProfileImageUrl,
  getPushEnabled,
  InvalidAvatarUrlError,
} from "../users";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDocs.mockResolvedValue({ docs: [] });
});

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

  describe("getPushEnabled", () => {
    it("defaults to enabled when the field was never written", async () => {
      // Push is ON by default — the absence of the field is the default, so no
      // migration is needed for existing accounts.
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ fcmTokens: [] }) });
      await expect(getPushEnabled("u1")).resolves.toBe(true);
    });

    it("defaults to enabled when the private profile doc is missing", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      await expect(getPushEnabled("u1")).resolves.toBe(true);
    });

    it("honors an explicit opt-out", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ pushEnabled: false }) });
      await expect(getPushEnabled("u1")).resolves.toBe(false);
    });

    it("fails open when the read errors", async () => {
      // A transient Firestore failure must not present as "you turned push off".
      mockGetDoc.mockRejectedValueOnce(new Error("unavailable"));
      await expect(getPushEnabled("u1")).resolves.toBe(true);
      expect(mockLoggerWarn).toHaveBeenCalledWith("push_pref_read_failed", expect.objectContaining({ uid: "u1" }));
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
    it("returns false for a blocked username without a read", async () => {
      expect(await isUsernameAvailable("hitler_fan")).toBe(false);
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

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

    it("rejects a blocked username", async () => {
      await expect(createProfile("u1", "hitler_fan", "regular", VALID_DOB, undefined, true)).rejects.toThrow(
        /isn't allowed/,
      );
    });

    // Helper: run the create-profile transaction and capture the two
    // tx.set payloads we care about — the public users/{uid} doc
    // (identified by the presence of `uid` + `username`) and the
    // private users/{uid}/private/profile doc (identified by the
    // presence of `dob`, which only lives on the private payload).
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
            else if ("dob" in data) captured.capturedPrivate = data;
          }),
        };
        return fn(tx);
      });

      return captured;
    }

    it("runs a transaction that reserves the username and creates public + private docs", async () => {
      stubTransaction();

      const result = await createProfile("u1", "SK8R", "regular", VALID_DOB, undefined, true);
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

    it("writes public doc without sensitive fields and private doc with dob only", async () => {
      const captured = stubTransaction();

      await createProfile("u1", "sk8r", "regular", VALID_DOB, undefined, true);

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

      // Private doc carries dob only. `emailVerified` is intentionally
      // NOT mirrored anymore (the createProfile parameter was removed): the
      // flag went stale for the majority of accounts, and Firebase Auth
      // (`auth.currentUser.emailVerified` + the JWT claim) is the
      // canonical source used by every reader.
      expect(captured.capturedPrivate).toMatchObject({ dob: VALID_DOB });
      expect(captured.capturedPrivate).not.toHaveProperty("emailVerified");
    });

    it("includes parentalConsent on the private doc when provided", async () => {
      const captured = stubTransaction();

      const result = await createProfile("u1", "sk8r", "regular", "2005-06-15", true, true);
      expect(result).toMatchObject({
        uid: "u1",
        username: "sk8r",
        stance: "regular",
      });
      expect(captured.capturedPrivate).toMatchObject({
        dob: "2005-06-15",
        parentalConsent: true,
      });
      expect(captured.capturedPrivate).not.toHaveProperty("emailVerified");
    });

    it("omits parentalConsent (but keeps dob) on the private doc when not provided", async () => {
      const captured = stubTransaction();

      await createProfile("u1", "sk8r", "regular", VALID_DOB, undefined, true);
      expect(captured.capturedPrivate).toHaveProperty("dob", VALID_DOB);
      expect(captured.capturedPrivate).not.toHaveProperty("parentalConsent");
      expect(captured.capturedPrivate).not.toHaveProperty("emailVerified");
    });

    it("stamps termsAcceptedAt with the server time on the private doc", async () => {
      const captured = stubTransaction();

      await createProfile("u1", "sk8r", "regular", VALID_DOB, undefined, true);
      expect(captured.capturedPrivate).toHaveProperty("termsAcceptedAt");
      // Never on the public doc.
      expect(captured.capturedPublic).not.toHaveProperty("termsAcceptedAt");
    });

    it("throws TermsAcceptanceRequiredError and writes nothing when terms were not accepted", async () => {
      await expect(createProfile("u1", "sk8r", "regular", VALID_DOB)).rejects.toMatchObject({
        name: "TermsAcceptanceRequiredError",
      });
      await expect(createProfile("u1", "sk8r", "regular", VALID_DOB, undefined, false)).rejects.toMatchObject({
        name: "TermsAcceptanceRequiredError",
      });
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it("throws AgeVerificationRequiredError when dob is missing (COPPA)", async () => {
      await expect(createProfile("u1", "sk8r", "regular")).rejects.toMatchObject({
        name: "AgeVerificationRequiredError",
      });
    });

    it("throws AgeVerificationRequiredError when dob is malformed", async () => {
      await expect(createProfile("u1", "sk8r", "regular", "not-a-date")).rejects.toMatchObject({
        name: "AgeVerificationRequiredError",
      });
      await expect(createProfile("u1", "sk8r", "regular", "2000/01/15")).rejects.toMatchObject({
        name: "AgeVerificationRequiredError",
      });
    });

    it("throws when username is too short", async () => {
      await expect(createProfile("u1", "ab", "regular", VALID_DOB, undefined, true)).rejects.toThrow(
        "Username must be",
      );
    });

    it("throws when username is too long", async () => {
      await expect(createProfile("u1", "a".repeat(21), "regular", VALID_DOB, undefined, true)).rejects.toThrow(
        "Username must be",
      );
    });

    it("throws when username has invalid characters", async () => {
      await expect(createProfile("u1", "sk8r!", "regular", VALID_DOB, undefined, true)).rejects.toThrow(
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

      await expect(createProfile("u1", "sk8r", "regular", VALID_DOB, undefined, true)).rejects.toThrow(
        "Username is already taken",
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

    it("skips test accounts but keeps docs with the flag absent or false", async () => {
      const profiles = [
        { uid: "u1", username: "real", stance: "regular" },
        { uid: "u2", username: "qa_tester_1", stance: "goofy", isTestAccount: true },
        { uid: "u3", username: "flag_off", stance: "goofy", isTestAccount: false },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getPlayerDirectory();
      expect(result.map((p) => p.username)).toEqual(["real", "flag_off"]);
      // No server-side filter: a where() on the flag would drop every doc without it.
      expect(mockWhere).not.toHaveBeenCalledWith("isTestAccount", expect.anything(), expect.anything());
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
    it("ranks rated players by win rate, provisional players last", async () => {
      const profiles = [
        // 3 games — below the 5-game floor, so provisional regardless of rate.
        { uid: "u1", username: "alice", wins: 2, losses: 1, createdAt: null, emailVerified: true, stance: "regular" },
        { uid: "u2", username: "bob", wins: 5, losses: 0, createdAt: null, emailVerified: true, stance: "goofy" },
        { uid: "u3", username: "charlie", wins: 2, losses: 3, createdAt: null, emailVerified: true, stance: "regular" },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getLeaderboard();

      expect(result.map((p) => p.username)).toEqual([
        "bob", // rated: 5-0 = 100%
        "charlie", // rated: 2-3 = 40%
        "alice", // provisional: only 3 games
      ]);
    });

    it("keeps a rated player ahead of a provisional one when listed first", async () => {
      // Mirror of the case above with the input order flipped, so the
      // comparator is exercised in both argument orders.
      const profiles = [
        { uid: "u1", username: "rated", wins: 5, losses: 0, createdAt: null, emailVerified: true, stance: "regular" },
        { uid: "u2", username: "prov", wins: 3, losses: 0, createdAt: null, emailVerified: true, stance: "goofy" },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getLeaderboard();

      expect(result.map((p) => p.username)).toEqual(["rated", "prov"]);
    });

    it("breaks an identical win rate by game volume", async () => {
      // Both are 100% and both are rated, so neither rate branch decides it —
      // the deeper run of wins does.
      const profiles = [
        { uid: "u1", username: "alice", wins: 6, losses: 0, createdAt: null, emailVerified: true, stance: "regular" },
        { uid: "u2", username: "bob", wins: 12, losses: 0, createdAt: null, emailVerified: true, stance: "goofy" },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getLeaderboard();

      expect(result.map((p) => p.username)).toEqual(["bob", "alice"]);
    });

    it("does not let raw win volume outrank a better win rate", async () => {
      // The regression this sort exists to fix: under the old
      // `orderBy('wins')` ranking, 50-200 (20%) outranked 20-0 (100%).
      const profiles = [
        {
          uid: "u1",
          username: "grinder",
          wins: 50,
          losses: 200,
          createdAt: null,
          emailVerified: true,
          stance: "regular",
        },
        { uid: "u2", username: "ripper", wins: 20, losses: 0, createdAt: null, emailVerified: true, stance: "goofy" },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getLeaderboard();

      expect(result.map((p) => p.username)).toEqual(["ripper", "grinder"]);
    });

    it("leaves test accounts off the leaderboard", async () => {
      const profiles = [
        { uid: "u1", username: "qa_tester_2", wins: 9, losses: 0, isTestAccount: true, stance: "regular" },
        { uid: "u2", username: "real", wins: 5, losses: 0, stance: "goofy" },
      ];
      mockGetDocs.mockResolvedValueOnce({ docs: profiles.map((p) => ({ data: () => p })) });

      const result = await getLeaderboard();

      expect(result.map((p) => p.username)).toEqual(["real"]);
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

    it("fails closed when the build has no storage bucket configured", async () => {
      vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", undefined);
      await expect(setProfileImageUrl("u1", validUrl("u1"))).rejects.toBeInstanceOf(InvalidAvatarUrlError);
      expect(mockRunTransaction).not.toHaveBeenCalled();
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
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetDoc,
  mockGetDocs,
  mockCacheGetDoc,
  mockCacheGetDocs,
  mockStartAfter,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockOrderBy,
  mockLimitFn,
  mockTimestampClass,
} = vi.hoisted(() => {
  // Minimal Timestamp stand-in — must be recognised by `instanceof` inside
  // userData.ts so we re-export the same class from the firebase/firestore
  // mock below.
  class FakeTimestamp {
    constructor(
      public seconds: number,
      public nanoseconds: number,
    ) {}
    toDate(): Date {
      return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000);
    }
  }

  return {
    // Server reads (getDocFromServer / getDocsFromServer): what the export uses.
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    // Cache-capable reads (getDoc / getDocs): the export must never use these.
    mockCacheGetDoc: vi.fn(),
    mockCacheGetDocs: vi.fn(),
    mockStartAfter: vi.fn((d: { id: string }) => ({ startAfter: d.id })),
    mockDoc: vi.fn((_db: unknown, ...pathSegments: string[]) => ({ path: pathSegments.join("/") })),
    mockCollection: vi.fn((_db: unknown, ...pathSegments: string[]) => ({ path: pathSegments.join("/") })),
    mockQuery: vi.fn((...args: unknown[]) => args),
    mockWhere: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    mockOrderBy: vi.fn((...args: unknown[]) => args),
    mockLimitFn: vi.fn((...args: unknown[]) => args),
    mockTimestampClass: FakeTimestamp,
  };
});

vi.mock("firebase/firestore", () => ({
  Timestamp: mockTimestampClass,
  collection: mockCollection,
  doc: mockDoc,
  getDoc: mockCacheGetDoc,
  getDocs: mockCacheGetDocs,
  getDocFromServer: mockGetDoc,
  getDocsFromServer: mockGetDocs,
  limit: mockLimitFn,
  startAfter: mockStartAfter,
  orderBy: mockOrderBy,
  query: mockQuery,
  where: mockWhere,
}));

vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
}));

// One attempt per read: retry timing is withRetry's own concern (retry.test.ts).
const mockWithRetry = vi.fn((fn: () => Promise<unknown>) => fn());
vi.mock("../../utils/retry", () => ({
  withRetry: (fn: () => Promise<unknown>) => mockWithRetry(fn),
}));

const mockCaptureMessage = vi.fn();
vi.mock("../../lib/sentry", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

const mockLoggerWarn = vi.fn();
vi.mock("../logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  describeIncompleteExport,
  describeMissingSections,
  EXPORT_FAILED_MESSAGE,
  UserDataExportError,
  exportUserData,
  serializeUserData,
  userDataFilename,
  USER_DATA_EXPORT_SCHEMA_VERSION,
  type UserDataExport,
} from "../userData";

/** Convenience factory for test bundles with all required fields. */
function emptyBundle(overrides?: Partial<UserDataExport>): UserDataExport {
  return {
    schemaVersion: 2,
    exportedAt: "2026-04-15T00:00:00.000Z",
    complete: true,
    missingSections: [],
    truncatedSections: [],
    capped: false,
    subject: { uid: "u1", username: "sk8r" },
    profile: null,
    usernameReservation: null,
    games: [],
    clips: [],
    clipVotes: [],
    spots: [],
    notifications: [],
    nudges: [],
    blockedUsers: [],
    reports: [],
    moderationStatements: [],
    appeals: [],
    ...overrides,
  };
}

function buildDoc(id: string, path: string, data: unknown) {
  return {
    id,
    ref: { path },
    data: () => data,
  };
}

function buildSingleDoc(exists: boolean, data: unknown, id = "doc") {
  return {
    id,
    exists: () => exists,
    data: () => data,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
});

/**
 * Which export query a mocked `query()` result is, e.g. "games:player1Uid" or
 * "users/u1/blocked_users", plus its page (1 = first page). The mocked
 * `query()` returns its arguments, so a next page is `[firstPage, startAfter]`.
 */
function describeQuery(q: unknown): { key: string; page: number } {
  let page = 1;
  let args = q as unknown[];
  while (Array.isArray(args[0])) {
    page++;
    args = args[0] as unknown[];
  }
  const coll = (args[0] as { path: string }).path;
  const firstWhere = args.find((a) => a && typeof a === "object" && "field" in (a as object)) as
    { field: string } | undefined;
  return { key: firstWhere ? `${coll}:${firstWhere.field}` : coll, page };
}

/** n docs for a page of `coll`, ids `${prefix}${start}..`. */
function docsPage(prefix: string, start: number, n: number) {
  return Array.from({ length: n }, (_, i) => buildDoc(`${prefix}${start + i}`, `x/${prefix}${start + i}`, {}));
}

describe("userData service", () => {
  describe("exportUserData", () => {
    it("throws when uid is missing", async () => {
      await expect(exportUserData("", "sk8r")).rejects.toThrow("requires a uid");
    });

    it("bundles all surfaces into one export", async () => {
      const profileData = { uid: "u1", username: "sk8r", wins: 5 };
      const usernameData = { uid: "u1", reservedAt: new mockTimestampClass(1_700_000_000, 0) };

      mockGetDoc
        .mockResolvedValueOnce(buildSingleDoc(true, profileData, "u1")) // profile
        .mockResolvedValueOnce(buildSingleDoc(true, usernameData, "sk8r")); // username reservation

      mockGetDocs
        .mockResolvedValueOnce({ docs: [buildDoc("g1", "games/g1", { player1Uid: "u1" })] }) // games p1
        .mockResolvedValueOnce({ docs: [buildDoc("g2", "games/g2", { player2Uid: "u1" })] }) // games p2
        .mockResolvedValueOnce({ docs: [] }) // games judge
        .mockResolvedValueOnce({ docs: [buildDoc("c1", "clips/c1", { playerUid: "u1", trickName: "kickflip" })] })
        .mockResolvedValueOnce({ docs: [buildDoc("cv1", "clipVotes/cv1", { uid: "u1" })] }) // clipVotes
        .mockResolvedValueOnce({ docs: [buildDoc("s1", "spots/s1", { createdBy: "u1", isActive: true })] }) // spots
        .mockResolvedValueOnce({ docs: [buildDoc("s0", "spots/s0", { createdBy: "u1", isActive: false })] }) // inactive
        .mockResolvedValueOnce({ docs: [] }) // notifications
        .mockResolvedValueOnce({ docs: [] }) // nudges sent
        .mockResolvedValueOnce({ docs: [] }) // nudges received
        .mockResolvedValueOnce({ docs: [buildDoc("b1", "users/u1/blocked_users/b1", { blockedUid: "b1" })] })
        .mockResolvedValueOnce({ docs: [buildDoc("r1", "reports/r1", { reporterUid: "u1", reason: "spam" })] })
        .mockResolvedValueOnce({ docs: [buildDoc("st1", "moderationStatements/st1", { subjectUid: "u1" })] })
        .mockResolvedValueOnce({ docs: [buildDoc("ap1", "appeals/ap1", { appellantUid: "u1" })] });

      const bundle = await exportUserData("u1", "SK8R");

      expect(bundle.schemaVersion).toBe(USER_DATA_EXPORT_SCHEMA_VERSION);
      expect(bundle.complete).toBe(true);
      expect(bundle.missingSections).toEqual([]);
      expect(bundle.truncatedSections).toEqual([]);
      expect(bundle).not.toHaveProperty("notice");
      expect(bundle.capped).toBe(false);
      // A complete export sends nothing to Sentry.
      expect(mockCaptureMessage).not.toHaveBeenCalled();
      expect(bundle.subject).toEqual({ uid: "u1", username: "sk8r" });
      expect(bundle.profile?.data).toEqual(profileData);
      expect(bundle.usernameReservation?.id).toBe("sk8r");
      expect(bundle.games).toHaveLength(2);
      expect(bundle.games[0].id).toBe("g1");
      expect(bundle.clips).toHaveLength(1);
      expect(bundle.clipVotes).toHaveLength(1);
      // Active and admin-deactivated spots both land in the one section.
      expect(bundle.spots.map((x) => x.id).sort()).toEqual(["s0", "s1"]);
      expect(bundle.notifications).toHaveLength(0);
      expect(bundle.nudges).toHaveLength(0);
      expect(bundle.blockedUsers).toHaveLength(1);
      expect(bundle.reports).toHaveLength(1);
      expect(bundle.moderationStatements).toHaveLength(1);
      expect(bundle.appeals).toHaveLength(1);
      expect(() => new Date(bundle.exportedAt).toISOString()).not.toThrow();
    });

    it("deduplicates games that appear in both player1 and player2 queries", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));

      const sharedGame = buildDoc("g1", "games/g1", { status: "complete" });
      mockGetDocs
        .mockResolvedValueOnce({ docs: [sharedGame] }) // games p1
        .mockResolvedValueOnce({ docs: [sharedGame] }) // games p2
        .mockResolvedValueOnce({ docs: [] }) // games judge
        .mockResolvedValueOnce({ docs: [] }) // clips
        .mockResolvedValueOnce({ docs: [] }) // clipVotes
        .mockResolvedValueOnce({ docs: [] }) // spots
        .mockResolvedValueOnce({ docs: [] }) // spots inactive
        .mockResolvedValueOnce({ docs: [] }) // notifications
        .mockResolvedValueOnce({ docs: [] }) // nudges sent
        .mockResolvedValueOnce({ docs: [] }) // nudges received
        .mockResolvedValueOnce({ docs: [] }) // blocks
        .mockResolvedValueOnce({ docs: [] }) // reports
        .mockResolvedValueOnce({ docs: [] }) // statements
        .mockResolvedValueOnce({ docs: [] }); // appeals

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.games).toHaveLength(1);
    });

    it("returns null profile when doc doesn't exist", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.profile).toBeNull();
      expect(bundle.usernameReservation).toBeNull();
      // Not there is not the same as couldn't read it.
      expect(bundle.complete).toBe(true);
      expect(bundle.missingSections).toEqual([]);
    });

    it("skips username reservation when username is blank", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "   ");
      expect(bundle.usernameReservation).toBeNull();
      // Only one getDoc call — the profile. No username lookup.
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it("normalises Firestore Timestamps to ISO strings", async () => {
      const ts = new mockTimestampClass(1_700_000_000, 0);
      const profileData = { uid: "u1", createdAt: ts };
      mockGetDoc
        .mockResolvedValueOnce(buildSingleDoc(true, profileData, "u1"))
        .mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.profile?.data.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    });

    it("coerces non-object doc data to an empty object", async () => {
      // Firestore's data() shouldn't ever return a primitive, but the
      // fallback keeps ExportedDoc.data well-typed if it does.
      mockGetDoc
        .mockResolvedValueOnce(buildSingleDoc(true, "not-an-object", "u1"))
        .mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.profile?.data).toEqual({});
    });

    it("normalises Timestamps nested in arrays", async () => {
      const ts = new mockTimestampClass(1_700_000_000, 0);
      const profileData = { uid: "u1", history: [{ when: ts, what: "login" }] };
      mockGetDoc
        .mockResolvedValueOnce(buildSingleDoc(true, profileData, "u1"))
        .mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      const history = bundle.profile?.data.history as Array<Record<string, unknown>>;
      expect(history[0].when).toBe(new Date(1_700_000_000_000).toISOString());
    });

    it("deduplicates nudges that appear in both sent and received queries", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));

      const sharedNudge = buildDoc("n1", "nudges/n1", { senderUid: "u1", recipientUid: "u1" });
      mockGetDocs
        .mockResolvedValueOnce({ docs: [] }) // games p1
        .mockResolvedValueOnce({ docs: [] }) // games p2
        .mockResolvedValueOnce({ docs: [] }) // games judge
        .mockResolvedValueOnce({ docs: [] }) // clips
        .mockResolvedValueOnce({ docs: [] }) // clipVotes
        .mockResolvedValueOnce({ docs: [] }) // spots
        .mockResolvedValueOnce({ docs: [] }) // spots inactive
        .mockResolvedValueOnce({ docs: [] }) // notifications
        .mockResolvedValueOnce({ docs: [sharedNudge] }) // nudges sent
        .mockResolvedValueOnce({ docs: [sharedNudge] }) // nudges received
        .mockResolvedValueOnce({ docs: [] }) // blocks
        .mockResolvedValueOnce({ docs: [] }) // reports
        .mockResolvedValueOnce({ docs: [] }) // statements
        .mockResolvedValueOnce({ docs: [] }); // appeals

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.nudges).toHaveLength(1);
    });

    it("reads only from the server, never the offline cache", async () => {
      mockGetDoc.mockResolvedValue(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      await exportUserData("u1", "sk8r");
      // Offline, getDoc/getDocs answer from cache and look like success; the
      // server-only reads throw `unavailable` instead, so the gap is named.
      expect(mockCacheGetDoc).not.toHaveBeenCalled();
      expect(mockCacheGetDocs).not.toHaveBeenCalled();
      expect(mockGetDoc).toHaveBeenCalledTimes(2);
      expect(mockGetDocs).toHaveBeenCalledTimes(14);
    });

    it("names a section the server couldn't be reached for (offline) instead of calling the file complete", async () => {
      mockGetDoc.mockResolvedValue(buildSingleDoc(true, { uid: "u1" }, "u1"));
      mockGetDocs.mockImplementation(async (q: unknown) => {
        if (describeQuery(q).key === "notifications:recipientUid") {
          throw Object.assign(new Error("Failed to get documents from server."), { code: "unavailable" });
        }
        return { docs: [] };
      });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toEqual(["notifications"]);
      expect(bundle.notice).toContain("We couldn't load all of your notifications this time");
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_collection_failed", {
        section: "notifications",
        code: "unavailable",
      });
    });

    it("pages through a long list with startAfter until a page comes back short", async () => {
      mockGetDoc.mockResolvedValue(buildSingleDoc(false, null));
      mockGetDocs.mockImplementation(async (q: unknown) => {
        const { key, page } = describeQuery(q);
        if (key !== "games:player1Uid") return { docs: [] };
        return { docs: page === 1 ? docsPage("g", 0, 500) : docsPage("g", 500, 3) };
      });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.games).toHaveLength(503);
      expect(mockStartAfter).toHaveBeenCalledTimes(1);
      expect(mockStartAfter).toHaveBeenCalledWith(expect.objectContaining({ id: "g499" }));
      expect(bundle.complete).toBe(true);
      expect(bundle.truncatedSections).toEqual([]);
      expect(bundle.capped).toBe(false);
    });

    it("stops at the page ceiling and marks the list incomplete instead of cutting it off silently", async () => {
      mockGetDoc.mockResolvedValue(buildSingleDoc(false, null));
      let notificationPages = 0;
      mockGetDocs.mockImplementation(async (q: unknown) => {
        const { key, page } = describeQuery(q);
        if (key !== "notifications:recipientUid") return { docs: [] };
        notificationPages++;
        return { docs: docsPage("n", (page - 1) * 500, 500) };
      });

      const bundle = await exportUserData("u1", "sk8r");
      expect(notificationPages).toBe(10);
      expect(bundle.notifications).toHaveLength(5000);
      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toEqual([]);
      expect(bundle.truncatedSections).toEqual(["notifications"]);
      expect(bundle.capped).toBe(true);
      expect(bundle.notice).toBe(
        "Some of your data is missing from this file. You have more than 5,000 items in your notifications, " +
          "so the file holds the first 5,000. If you need a complete copy, email privacy@skatehubba.com.",
      );
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_list_truncated", {
        section: "notifications",
        pages: 10,
      });
    });

    it("keeps the pages it got when a later page fails, and names the section", async () => {
      mockGetDoc.mockResolvedValue(buildSingleDoc(false, null));
      mockGetDocs.mockImplementation(async (q: unknown) => {
        const { key, page } = describeQuery(q);
        if (key !== "clips:playerUid") return { docs: [] };
        if (page === 1) return { docs: docsPage("c", 0, 500) };
        throw Object.assign(new Error("deadline"), { code: "deadline-exceeded" });
      });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.clips).toHaveLength(500);
      expect(bundle.missingSections).toEqual(["clips"]);
      expect(bundle.complete).toBe(false);
    });

    it("sends partial exports to Sentry as a warning with section names and error codes only", async () => {
      mockGetDoc
        .mockResolvedValueOnce(buildSingleDoc(true, { uid: "u1", username: "sk8r", email: "a@b.test" }, "u1"))
        .mockResolvedValueOnce(buildSingleDoc(true, { uid: "u1" }, "sk8r"));
      mockGetDocs.mockImplementation(async (q: unknown) => {
        if (describeQuery(q).key === "spots:createdBy") {
          throw Object.assign(new Error("Missing or insufficient permissions on users/u1"), {
            code: "permission-denied",
          });
        }
        return { docs: [] };
      });

      await exportUserData("u1", "sk8r");
      expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
      expect(mockCaptureMessage).toHaveBeenCalledWith("user_data_export_partial", {
        level: "warning",
        extra: {
          missingSections: ["spots"],
          truncatedSections: [],
          codes: { spots: "permission-denied", spotsInactive: "permission-denied" },
        },
      });
      // Nothing that identifies the user, and not the raw error message.
      const sent = JSON.stringify([mockCaptureMessage.mock.calls, mockLoggerWarn.mock.calls]);
      expect(sent).not.toContain("u1");
      expect(sent).not.toContain("sk8r");
      expect(sent).not.toContain("a@b.test");
      expect(sent).not.toContain("insufficient");
    });

    it("keeps active spots and names spots as missing when the inactive-spots read is refused (rules not deployed yet)", async () => {
      mockGetDoc.mockResolvedValue(buildSingleDoc(true, { uid: "u1" }, "u1"));
      mockGetDocs.mockImplementation(async (q: unknown) => {
        const args = q as unknown[];
        const isSpots = describeQuery(q).key === "spots:createdBy";
        const inactive = args.some((a) => a && typeof a === "object" && (a as { value?: unknown }).value === false);
        if (isSpots && inactive) throw Object.assign(new Error("denied"), { code: "permission-denied" });
        if (isSpots) return { docs: [buildDoc("s1", "spots/s1", { createdBy: "u1", isActive: true })] };
        return { docs: [] };
      });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.spots.map((x) => x.id)).toEqual(["s1"]);
      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toEqual(["spots"]);
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_collection_failed", {
        section: "spotsInactive",
        code: "permission-denied",
      });
    });

    it("throws instead of making a near-empty file when nothing could be read", async () => {
      const offline = () => Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" }));
      mockGetDoc.mockImplementation(offline);
      mockGetDocs.mockImplementation(offline);

      const err = await exportUserData("u1", "sk8r").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserDataExportError);
      expect((err as Error).message).toBe(EXPORT_FAILED_MESSAGE);
      expect((err as UserDataExportError).codes).toMatchObject({
        profile: "unavailable",
        usernameReservation: "unavailable",
        gamesAsPlayer1: "unavailable",
        spotsInactive: "unavailable",
        appeals: "unavailable",
      });
      expect(Object.keys((err as UserDataExportError).codes)).toHaveLength(16);
      // The thrown error is reported by the caller; no extra partial event.
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });

    it("still makes a file when only one read works", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(true, { uid: "u1" }, "u1"));
      mockGetDoc.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "unavailable" }));
      mockGetDocs.mockRejectedValue(Object.assign(new Error("x"), { code: "unavailable" }));

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.profile?.id).toBe("u1");
      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toHaveLength(11);
    });

    it("throws when nothing could be read and there is no username to look up", async () => {
      mockGetDoc.mockRejectedValue(Object.assign(new Error("x"), { code: "unavailable" }));
      mockGetDocs.mockRejectedValue(new Error("no code"));

      const err = await exportUserData("u1", "").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserDataExportError);
      expect((err as UserDataExportError).codes).not.toHaveProperty("usernameReservation");
      expect((err as UserDataExportError).codes.clips).toBe("unknown");
    });

    it("names a section that failed to load instead of exporting it as silently empty", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));

      mockGetDocs
        .mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "failed-precondition" })) // games p1
        .mockResolvedValue({ docs: [] }); // remaining surfaces

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.games).toEqual([]);
      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toEqual(["games"]);
      expect(bundle.notice).toBe(
        "Some of your data is missing from this file. We couldn't load all of your game history this time, " +
          "so that part of the file may be empty or incomplete. Try again in a few minutes. If you need a " +
          "complete copy, email privacy@skatehubba.com.",
      );
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_collection_failed", {
        section: "gamesAsPlayer1",
        code: "failed-precondition",
      });
    });

    it("lists every failed section once, in a fixed order", async () => {
      mockGetDoc
        .mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "unavailable" })) // profile
        .mockResolvedValueOnce(buildSingleDoc(false, null));
      const fail = () => Promise.reject(Object.assign(new Error("nope"), { code: "permission-denied" }));
      mockGetDocs
        .mockImplementationOnce(fail) // games p1
        .mockImplementationOnce(fail) // games p2 (same section, listed once)
        .mockResolvedValueOnce({ docs: [] }) // games judge
        .mockResolvedValueOnce({ docs: [] }) // clips
        .mockResolvedValueOnce({ docs: [] }) // clipVotes
        .mockImplementationOnce(fail) // spots
        .mockImplementationOnce(fail) // spots inactive (same section, listed once)
        .mockResolvedValueOnce({ docs: [] }) // notifications
        .mockResolvedValueOnce({ docs: [] }) // nudges sent
        .mockImplementationOnce(fail) // nudges received
        .mockResolvedValue({ docs: [] }); // the rest

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toEqual(["profile", "games", "spots", "nudges"]);
      expect(bundle.notice).toContain("all of your profile, game history, spots and nudges this time");
    });

    it("names the username section when its read fails", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(true, { uid: "u1" }, "u1"));
      mockGetDoc.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "unavailable" }));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.usernameReservation).toBeNull();
      expect(bundle.missingSections).toEqual(["usernameReservation"]);
    });

    it("sorts each list newest first in memory (the queries have no orderBy)", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));
      const at = (s: number) => new mockTimestampClass(s, 0);
      mockGetDocs
        .mockResolvedValueOnce({
          docs: [
            buildDoc("old", "games/old", { createdAt: at(1_700_000_000) }),
            buildDoc("undated", "games/undated", {}),
          ],
        }) // games p1
        .mockResolvedValueOnce({ docs: [buildDoc("new", "games/new", { createdAt: at(1_800_000_000) })] }) // p2
        .mockResolvedValueOnce({ docs: [buildDoc("mid", "games/mid", { createdAt: at(1_750_000_000) })] }) // judge
        .mockResolvedValueOnce({
          docs: [
            buildDoc("c-num", "clips/c-num", { createdAt: 1_600_000_000_000 }),
            buildDoc("c-bad", "clips/c-bad", { createdAt: "not a date" }),
            buildDoc("c-new", "clips/c-new", { createdAt: at(1_700_000_000) }),
            buildDoc("c-tie", "clips/c-tie", { createdAt: at(1_700_000_000) }),
          ],
        }) // clips
        .mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.games.map((g) => g.id)).toEqual(["new", "mid", "old", "undated"]);
      expect(bundle.clips.map((c) => c.id)).toEqual(["c-new", "c-tie", "c-num", "c-bad"]);
    });

    it("runs equality-only queries (no orderBy) and reads spots as one active and one inactive query", async () => {
      mockGetDoc.mockResolvedValue(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      await exportUserData("u1", "sk8r");
      expect(mockOrderBy).not.toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalledWith("createdBy", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("isActive", "==", true);
      expect(mockWhere).toHaveBeenCalledWith("isActive", "==", false);
      expect(mockLimitFn).toHaveBeenCalledWith(500);
      expect(mockStartAfter).not.toHaveBeenCalled();
    });

    it("returns null when profile read fails", async () => {
      mockGetDoc
        .mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "permission-denied" }))
        .mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.profile).toBeNull();
      expect(bundle.missingSections).toEqual(["profile"]);
      // A fixed section name, never the doc path (which holds the uid).
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_doc_failed", {
        section: "profile",
        code: "permission-denied",
      });
    });
  });

  describe("describeMissingSections", () => {
    it.each([
      [[], ""],
      [["games"], "game history"],
      [["games", "clips"], "game history and clips"],
      [["profile", "reports", "appeals"], "profile, reports and appeals"],
      [["spots", "blockedUsers"], "spots and blocked list"],
    ] as const)("%j reads as %j", (sections, expected) => {
      expect(describeMissingSections(sections)).toBe(expected);
    });
  });

  describe("describeIncompleteExport", () => {
    it("is empty when nothing is missing", () => {
      expect(describeIncompleteExport([], [])).toBe("");
    });

    it("covers failed reads and several long lists together", () => {
      expect(describeIncompleteExport(["games"], ["notifications", "clipVotes"])).toBe(
        "We couldn't load all of your game history this time, so that part of the file may be empty or " +
          "incomplete. Try again in a few minutes. You have more than 5,000 items in each of your notifications " +
          "and clip votes, so the file holds the first 5,000 of each. If you need a complete copy, email privacy@skatehubba.com.",
      );
    });
  });

  describe("serializeUserData", () => {
    it("returns pretty-printed JSON", () => {
      const bundle = emptyBundle();
      const json = serializeUserData(bundle);
      expect(json).toContain("\n  ");
      expect(JSON.parse(json)).toEqual(bundle);
    });
  });

  describe("userDataFilename", () => {
    it("uses username and date", () => {
      const name = userDataFilename(emptyBundle({ exportedAt: "2026-04-15T12:34:56.000Z" }));
      expect(name).toBe("skatehubba-data-sk8r-2026-04-15.json");
    });

    it("falls back to 'user' when username is empty", () => {
      const name = userDataFilename(emptyBundle({ subject: { uid: "u1", username: "" } }));
      expect(name).toBe("skatehubba-data-user-2026-04-15.json");
    });

    it("strips illegal filesystem characters from username", () => {
      const name = userDataFilename(emptyBundle({ subject: { uid: "u1", username: "sk8r/../etc" } }));
      expect(name).toBe("skatehubba-data-sk8retc-2026-04-15.json");
    });
  });
});

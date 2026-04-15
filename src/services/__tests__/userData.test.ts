import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDoc, mockGetDocs, mockDoc, mockCollection, mockQuery, mockWhere, mockTimestampClass } = vi.hoisted(
  () => {
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
      mockGetDoc: vi.fn(),
      mockGetDocs: vi.fn(),
      mockDoc: vi.fn((_db: unknown, ...pathSegments: string[]) => ({ path: pathSegments.join("/") })),
      mockCollection: vi.fn((_db: unknown, ...pathSegments: string[]) => ({ path: pathSegments.join("/") })),
      mockQuery: vi.fn((...args: unknown[]) => args),
      mockWhere: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
      mockTimestampClass: FakeTimestamp,
    };
  },
);

vi.mock("firebase/firestore", () => ({
  Timestamp: mockTimestampClass,
  collection: mockCollection,
  doc: mockDoc,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  query: mockQuery,
  where: mockWhere,
}));

vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
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

import { exportUserData, serializeUserData, userDataFilename, USER_DATA_EXPORT_SCHEMA_VERSION } from "../userData";

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
});

describe("userData service", () => {
  describe("exportUserData", () => {
    it("throws when uid is missing", async () => {
      await expect(exportUserData("", "sk8r")).rejects.toThrow("requires a uid");
    });

    it("bundles profile, games, clips, blocks, and reports into one export", async () => {
      const profileData = { uid: "u1", username: "sk8r", wins: 5 };
      const usernameData = { uid: "u1", reservedAt: new mockTimestampClass(1_700_000_000, 0) };

      mockGetDoc
        .mockResolvedValueOnce(buildSingleDoc(true, profileData, "u1")) // profile
        .mockResolvedValueOnce(buildSingleDoc(true, usernameData, "sk8r")); // username reservation

      mockGetDocs
        .mockResolvedValueOnce({
          docs: [buildDoc("g1", "games/g1", { player1Uid: "u1", status: "complete" })],
        })
        .mockResolvedValueOnce({
          docs: [buildDoc("g2", "games/g2", { player2Uid: "u1", status: "complete" })],
        })
        .mockResolvedValueOnce({
          docs: [buildDoc("c1", "clips/c1", { playerUid: "u1", trickName: "kickflip" })],
        })
        .mockResolvedValueOnce({
          docs: [buildDoc("blocked-uid", "users/u1/blocked_users/blocked-uid", { blockedUid: "blocked-uid" })],
        })
        .mockResolvedValueOnce({
          docs: [buildDoc("r1", "reports/r1", { reporterUid: "u1", reason: "spam" })],
        });

      const bundle = await exportUserData("u1", "SK8R");

      expect(bundle.schemaVersion).toBe(USER_DATA_EXPORT_SCHEMA_VERSION);
      expect(bundle.subject).toEqual({ uid: "u1", username: "sk8r" });
      expect(bundle.profile?.data).toEqual(profileData);
      expect(bundle.usernameReservation?.id).toBe("sk8r");
      expect(bundle.games).toHaveLength(2);
      expect(bundle.games[0].id).toBe("g1");
      expect(bundle.clips).toHaveLength(1);
      expect(bundle.blockedUsers).toHaveLength(1);
      expect(bundle.reports).toHaveLength(1);
      // exportedAt is an ISO string
      expect(() => new Date(bundle.exportedAt).toISOString()).not.toThrow();
    });

    it("deduplicates games that appear in both player1 and player2 queries", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));

      const sharedGame = buildDoc("g1", "games/g1", { status: "complete" });
      mockGetDocs
        .mockResolvedValueOnce({ docs: [sharedGame] })
        .mockResolvedValueOnce({ docs: [sharedGame] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] })
        .mockResolvedValueOnce({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.games).toHaveLength(1);
    });

    it("returns null profile when doc doesn't exist", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.profile).toBeNull();
      expect(bundle.usernameReservation).toBeNull();
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

    it("returns empty list when a collection read fails", async () => {
      mockGetDoc.mockResolvedValueOnce(buildSingleDoc(false, null)).mockResolvedValueOnce(buildSingleDoc(false, null));

      mockGetDocs
        .mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "permission-denied" })) // games p1
        .mockResolvedValueOnce({ docs: [] }) // games p2
        .mockResolvedValueOnce({ docs: [] }) // clips
        .mockResolvedValueOnce({ docs: [] }) // blocks
        .mockResolvedValueOnce({ docs: [] }); // reports

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.games).toEqual([]);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "user_data_export_collection_failed",
        expect.objectContaining({ label: "games (player1)" }),
      );
    });

    it("returns null when profile read fails", async () => {
      mockGetDoc
        .mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "permission-denied" }))
        .mockResolvedValueOnce(buildSingleDoc(false, null));
      mockGetDocs.mockResolvedValue({ docs: [] });

      const bundle = await exportUserData("u1", "sk8r");
      expect(bundle.profile).toBeNull();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "user_data_export_doc_failed",
        expect.objectContaining({ path: "users/u1" }),
      );
    });
  });

  describe("serializeUserData", () => {
    it("returns pretty-printed JSON", () => {
      const bundle = {
        schemaVersion: 1 as const,
        exportedAt: "2026-04-15T00:00:00.000Z",
        subject: { uid: "u1", username: "sk8r" },
        profile: null,
        usernameReservation: null,
        games: [],
        clips: [],
        blockedUsers: [],
        reports: [],
      };
      const json = serializeUserData(bundle);
      expect(json).toContain("\n  ");
      expect(JSON.parse(json)).toEqual(bundle);
    });
  });

  describe("userDataFilename", () => {
    it("uses username and date", () => {
      const name = userDataFilename({
        schemaVersion: 1,
        exportedAt: "2026-04-15T12:34:56.000Z",
        subject: { uid: "u1", username: "sk8r" },
        profile: null,
        usernameReservation: null,
        games: [],
        clips: [],
        blockedUsers: [],
        reports: [],
      });
      expect(name).toBe("skatehubba-data-sk8r-2026-04-15.json");
    });

    it("falls back to 'user' when username is empty", () => {
      const name = userDataFilename({
        schemaVersion: 1,
        exportedAt: "2026-04-15T12:34:56.000Z",
        subject: { uid: "u1", username: "" },
        profile: null,
        usernameReservation: null,
        games: [],
        clips: [],
        blockedUsers: [],
        reports: [],
      });
      expect(name).toBe("skatehubba-data-user-2026-04-15.json");
    });

    it("strips illegal filesystem characters from username", () => {
      const name = userDataFilename({
        schemaVersion: 1,
        exportedAt: "2026-04-15T00:00:00.000Z",
        subject: { uid: "u1", username: "sk8r/../etc" },
        profile: null,
        usernameReservation: null,
        games: [],
        clips: [],
        blockedUsers: [],
        reports: [],
      });
      expect(name).toBe("skatehubba-data-sk8retc-2026-04-15.json");
    });
  });
});

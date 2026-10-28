import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the registry-driven export. Firestore is replaced by a small
 * in-memory router: `doc`, `collection`, `collectionGroup`, `where`, `limit`
 * and `query` build plain descriptors, and the server reads look them up in
 * `store` by a readable key, e.g. "games?player1Uid==u1" or "users/u1".
 */
const h = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(
      public seconds: number,
      public nanoseconds: number,
    ) {}
    toDate(): Date {
      return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000);
    }
  }
  type Filter = { field: string; op: string; value: unknown };
  type Q = { kind: "query"; source: string; filters: Filter[]; after?: string };
  const toQuery = (base: unknown): Q => {
    const b = base as { kind: string; path?: string } & Partial<Q>;
    if (b.kind === "query") return { ...(b as Q), filters: [...(b as Q).filters] };
    return { kind: "query", source: b.path as string, filters: [] };
  };
  return {
    FakeTimestamp,
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockCacheGetDoc: vi.fn(),
    mockCacheGetDocs: vi.fn(),
    mockOrderBy: vi.fn(),
    mockWhere: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    doc: (_db: unknown, ...segs: string[]) => ({ kind: "doc", path: segs.join("/") }),
    collection: (_db: unknown, ...segs: string[]) => ({ kind: "coll", path: segs.join("/") }),
    collectionGroup: (_db: unknown, id: string) => ({ kind: "group", path: `**/${id}` }),
    limit: (n: number) => ({ limit: n }),
    startAfter: (d: { id: string }) => ({ startAfter: d.id }),
    query: (base: unknown, ...cs: unknown[]) => {
      const q = toQuery(base);
      for (const c of cs) {
        if (c && typeof c === "object" && "field" in c) q.filters.push(c as Filter);
        if (c && typeof c === "object" && "startAfter" in c) q.after = (c as { startAfter: string }).startAfter;
      }
      return q;
    },
    keyOf: (q: Q) => `${q.source}${q.filters.map((f) => `?${f.field}${f.op}${String(f.value)}`).join("")}`,
  };
});

vi.mock("firebase/firestore", () => ({
  Timestamp: h.FakeTimestamp,
  collection: h.collection,
  collectionGroup: h.collectionGroup,
  doc: h.doc,
  getDoc: h.mockCacheGetDoc,
  getDocs: h.mockCacheGetDocs,
  getDocFromServer: h.mockGetDoc,
  getDocsFromServer: h.mockGetDocs,
  limit: h.limit,
  startAfter: h.startAfter,
  orderBy: h.mockOrderBy,
  query: h.query,
  where: h.mockWhere,
}));

vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));

// One attempt per read: retry timing is withRetry's own concern (retry.test.ts).
vi.mock("../../utils/retry", () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }));

const mockCaptureMessage = vi.fn();
vi.mock("../../lib/sentry", () => ({ captureMessage: (...args: unknown[]) => mockCaptureMessage(...args) }));

const mockLoggerWarn = vi.fn();
vi.mock("../logger", () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  describeIncompleteExport,
  describeMissingSections,
  EXPORT_FAILED_MESSAGE,
  EXPORT_NOT_INCLUDED,
  NOT_INCLUDED_NOTICE,
  UserDataExportError,
  exportUserData,
  serializeUserData,
  userDataFilename,
  USER_DATA_EXPORT_SCHEMA_VERSION,
  type ExportSection,
  type UserDataExport,
} from "../userData";
import { EXPORT_MAX_PAGES, EXPORT_PAGE_SIZE, exportReadPlan, isIncluded } from "../userDataQueries";
import { FIRESTORE_EXPORT, type ExportPlan } from "../../../api/account/_userDataRegistry";

const UID = "u1";

type Docs = Array<{ id: string; path?: string; data: unknown }>;
type ListAnswer = Docs | Error | ((page: number) => Docs | Error);

/** Docs by path, and list answers by query key. Anything unset is empty. */
let docs: Record<string, unknown | Error> = {};
let lists: Record<string, ListAnswer> = {};

function fsError(code: string): Error {
  return Object.assign(new Error(`${code}: users/${UID} secret path`), { code });
}

function snapList(source: string, items: Array<{ id: string; path?: string; data: unknown }>) {
  return {
    docs: items.map((d) => ({ id: d.id, ref: { path: d.path ?? `${source}/${d.id}` }, data: () => d.data })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  docs = {};
  lists = {};
  h.mockGetDoc.mockImplementation(async (ref: { path: string }) => {
    const v = docs[ref.path];
    if (v instanceof Error) throw v;
    const id = ref.path.split("/").pop() as string;
    return { id, exists: () => v !== undefined, data: () => v };
  });
  // A page's number: 1 without a cursor, else one more than the page that
  // served the cursor doc.
  const pageOfDoc = new Map<string, number>();
  h.mockGetDocs.mockImplementation(async (q: Parameters<typeof h.keyOf>[0]) => {
    const key = h.keyOf(q);
    const page = q.after === undefined ? 1 : (pageOfDoc.get(`${key}#${q.after}`) as number) + 1;
    const raw: ListAnswer | undefined = lists[key];
    const a = typeof raw === "function" ? raw(page) : raw;
    if (Array.isArray(a)) for (const d of a) pageOfDoc.set(`${key}#${d.id}`, page);
    if (a instanceof Error) throw a;
    return snapList(q.source, a ?? []);
  });
});

function emptyBundle(overrides?: Partial<UserDataExport>): UserDataExport {
  const sections: Record<string, unknown> = {};
  for (const plan of Object.values(FIRESTORE_EXPORT) as ExportPlan[]) {
    if (isIncluded(plan)) sections[plan.section] = [];
  }
  return {
    ...(sections as unknown as UserDataExport),
    schemaVersion: USER_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: "2026-04-15T00:00:00.000Z",
    complete: true,
    missingSections: [],
    truncatedSections: [],
    capped: false,
    notIncluded: [],
    notIncludedNotice: "",
    redactedFields: {},
    subject: { uid: "u1", username: "sk8r" },
    profile: null,
    usernameReservation: null,
    ...overrides,
  };
}

const ts = (sec: number) => new h.FakeTimestamp(sec, 0);

describe("exportReadPlan", () => {
  let plan: ReturnType<typeof exportReadPlan>;
  beforeEach(() => {
    plan = exportReadPlan({} as never, UID, "sk8r");
  });

  it("has one read per registry read, with unique labels", () => {
    const labels = plan.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    // The two comment collections are one collection group, read once.
    expect(labels.filter((l) => l === "group:comments.userId")).toHaveLength(1);
  });

  it("covers every included section of the registry", () => {
    const sections = new Set(plan.map((p) => p.section));
    for (const p of Object.values(FIRESTORE_EXPORT) as ExportPlan[]) {
      if (isIncluded(p)) expect(sections.has(p.section as ExportSection)).toBe(true);
    }
  });

  it("never puts a uid or username in a log label", () => {
    for (const p of plan) {
      expect(p.label).not.toContain(UID);
      expect(p.label).not.toContain("sk8r");
    }
  });

  it("uses equality filters only, and reads spots once per isActive value (#910)", () => {
    expect(h.mockOrderBy).not.toHaveBeenCalled();
    const ops = new Set(h.mockWhere.mock.calls.map(([, op]) => op));
    expect([...ops].sort()).toEqual(["==", "array-contains"]);
    const spots = plan.filter((p) => p.section === "spots");
    expect(spots.map((p) => p.label)).toEqual(["spots.createdBy.isActive=true", "spots.createdBy.isActive=false"]);
    for (const [read, active] of [
      [spots[0], true],
      [spots[1], false],
    ] as const) {
      expect(read.step).toMatchObject({
        type: "query",
        first: {
          source: "spots",
          filters: [
            { field: "createdBy", value: UID },
            { field: "isActive", value: active },
          ],
        },
      });
    }
  });

  it("skips the username read when there is no username", () => {
    const blank = exportReadPlan({} as never, UID, "");
    expect(blank.find((p) => p.section === "usernameReservation")?.step).toBeNull();
  });
});

describe("exportUserData", () => {
  it("throws when uid is missing", async () => {
    await expect(exportUserData("", "x")).rejects.toThrow(/requires a uid/);
  });

  it("bundles every kind of read into one file", async () => {
    docs["users/u1"] = { username: "sk8r", createdAt: ts(1) };
    docs["usernames/sk8r"] = { uid: UID };
    docs["users/u1/profileCustom/main"] = { theme: "night" };
    docs["diceStats/u1"] = { rating: 1200 };
    docs["drops/d1/claims/u1"] = { claimedAt: ts(5) };
    lists["games?player1Uid==u1"] = [{ id: "g1", data: { createdAt: ts(10) } }];
    lists["games?judgeId==u1"] = [
      { id: "g1", data: { createdAt: ts(10) } },
      { id: "g2", data: { createdAt: ts(20) } },
    ];
    lists["users/u1/wallet"] = [{ id: "balance", data: { amount: 5 } }];
    lists["diceGames?playerUidsarray-contains" + "u1"] = [{ id: "dg1", data: {} }];
    lists["**/comments?userId==u1"] = [
      { id: "c1", path: "spots/s1/comments/c1", data: {} },
      { id: "c1", path: "clips/k1/comments/c1", data: {} },
    ];
    lists["drops"] = [
      { id: "d1", data: { title: "drop" } },
      { id: "d2", data: { title: "other drop" } },
    ];

    const bundle = await exportUserData(UID, "SK8R ");

    expect(bundle.schemaVersion).toBe(4);
    expect(bundle.complete).toBe(true);
    expect(bundle.notice).toBeUndefined();
    // complete means every read succeeded, not that the file holds it all:
    // what the client can't read is named, with where to ask for it.
    expect(bundle.notIncluded).toEqual([...EXPORT_NOT_INCLUDED]);
    expect(bundle.notIncludedNotice).toBe(NOT_INCLUDED_NOTICE);
    expect(bundle.subject).toEqual({ uid: UID, username: "sk8r" });
    expect(bundle.profile).toMatchObject({
      id: "u1",
      path: "users/u1",
      data: { createdAt: "1970-01-01T00:00:01.000Z" },
    });
    expect(bundle.usernameReservation?.path).toBe("usernames/sk8r");
    expect(bundle.profileCustom?.data).toEqual({ theme: "night" });
    expect(bundle.diceStats?.data).toEqual({ rating: 1200 });
    expect(bundle.mapState).toBeNull();
    // Played and judged the same game: one copy, newest first.
    expect(bundle.games.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(bundle.wallet.map((d) => d.path)).toEqual(["users/u1/wallet/balance"]);
    expect(bundle.diceGames.map((d) => d.id)).toEqual(["dg1"]);
    // Same id under two parents: both kept (deduped by path, not id).
    expect(bundle.comments.map((d) => d.path)).toEqual(["spots/s1/comments/c1", "clips/k1/comments/c1"]);
    // The user's claim under each drop; the drop docs themselves stay out.
    expect(bundle.dropClaims.map((d) => d.path)).toEqual(["drops/d1/claims/u1"]);
    expect(bundle.dropEntries).toEqual([]);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("has a key for every section, a list or one doc", async () => {
    const bundle = await exportUserData(UID, "sk8r");
    for (const p of Object.values(FIRESTORE_EXPORT) as ExportPlan[]) {
      if (isIncluded(p)) expect(bundle).toHaveProperty(p.section);
    }
    expect(bundle.games).toEqual([]);
    expect(bundle.profile).toBeNull();
  });

  it("leaves out device tokens and staff uids, and says which fields it left out", async () => {
    lists["users/u1/private"] = [{ id: "profile", data: { email: "a@b.c", fcmTokens: ["tok"] } }];
    docs["bans/u1"] = { reason: "spam", bannedBy: "admin-uid" };
    docs["users/u1"] = { username: "sk8r", verifiedBy: "admin-uid" };
    lists["reports?reporterUid==u1"] = [{ id: "r1", data: { reason: "x", resolvedBy: "admin-uid" } }];
    lists["moderationStatements?subjectUid==u1"] = [{ id: "m1", data: { reason: "y", createdBy: "admin-uid" } }];
    lists["appeals?appellantUid==u1"] = [{ id: "a1", data: { status: "upheld", reviewedBy: "admin-uid" } }];
    lists["disputes?setterUid==u1"] = [{ id: "d1", data: { adminRuling: "land", adminRuledBy: "admin-uid" } }];
    lists["proBlessings?targetUid==u1"] = [{ id: "b1", data: { status: "revoked", revokedBy: "admin-uid" } }];

    const bundle = await exportUserData(UID, "sk8r");
    const json = serializeUserData(bundle);

    expect(json).not.toContain("admin-uid");
    expect(json).not.toContain("tok");
    expect(bundle.privateProfile[0].data).toEqual({ email: "a@b.c" });
    expect(bundle.ban?.data).toEqual({ reason: "spam" });
    expect(bundle.redactedFields).toMatchObject({
      profile: ["verifiedBy"],
      privateProfile: ["fcmTokens"],
      ban: ["bannedBy"],
      reports: ["resolvedBy"],
      moderationStatements: ["createdBy"],
      appeals: ["reviewedBy"],
      disputes: ["adminRuledBy"],
      proBlessings: ["revokedBy"],
    });
  });

  it("skips the username reservation when username is blank, without calling it missing", async () => {
    docs["users/u1"] = { username: "" };
    const bundle = await exportUserData(UID, "   ");
    expect(bundle.usernameReservation).toBeNull();
    expect(bundle.complete).toBe(true);
    expect(h.mockGetDoc.mock.calls.some(([ref]) => (ref as { path: string }).path.startsWith("usernames/"))).toBe(
      false,
    );
  });

  it("normalises Timestamps, nested ones too, and coerces non-object data to {}", async () => {
    docs["users/u1"] = { history: [{ at: ts(2) }], nested: { at: ts(3) } };
    docs["diceStats/u1"] = "not an object";
    const bundle = await exportUserData(UID, "sk8r");
    expect(bundle.profile?.data).toEqual({
      history: [{ at: "1970-01-01T00:00:02.000Z" }],
      nested: { at: "1970-01-01T00:00:03.000Z" },
    });
    expect(bundle.diceStats?.data).toEqual({});
  });

  it("reads only from the server, never the offline cache", async () => {
    await exportUserData(UID, "sk8r");
    expect(h.mockGetDoc).toHaveBeenCalled();
    expect(h.mockGetDocs).toHaveBeenCalled();
    expect(h.mockCacheGetDoc).not.toHaveBeenCalled();
    expect(h.mockCacheGetDocs).not.toHaveBeenCalled();
  });

  it("sorts each list newest first in memory; docs without createdAt go last", async () => {
    lists["clips?playerUid==u1"] = [
      { id: "none", data: {} },
      { id: "old", data: { createdAt: ts(1) } },
      { id: "mid", data: { createdAt: 5000 } },
      { id: "new", data: { createdAt: ts(9) } },
      { id: "bad", data: { createdAt: "not a date" } },
      { id: "older", data: { createdAt: ts(0) } },
    ];
    const bundle = await exportUserData(UID, "sk8r");
    expect(bundle.clips.map((c) => c.id)).toEqual(["new", "mid", "old", "older", "none", "bad"]);
  });

  describe("partial files", () => {
    it("names a section that failed instead of exporting it as silently empty", async () => {
      lists["games?player2Uid==u1"] = fsError("unavailable");
      lists["games?player1Uid==u1"] = [{ id: "g1", data: {} }];
      lists["clips?playerUid==u1"] = [{ id: "k1", data: {} }];

      const bundle = await exportUserData(UID, "sk8r");

      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toEqual(["games"]);
      expect(bundle.games.map((g) => g.id)).toEqual(["g1"]);
      expect(bundle.clips.map((c) => c.id)).toEqual(["k1"]);
      expect(bundle.notice).toBe(
        "Some of your data is missing from this file. We couldn't load all of your game history this time, so " +
          "that part of the file may be empty or incomplete. Try again in a few minutes. If you need a complete " +
          "copy, email privacy@skatehubba.com.",
      );
    });

    it("puts active and deactivated spots in one section, newest first", async () => {
      lists["spots?createdBy==u1?isActive==true"] = [{ id: "s1", data: { isActive: true, createdAt: ts(10) } }];
      lists["spots?createdBy==u1?isActive==false"] = [{ id: "s0", data: { isActive: false, createdAt: ts(20) } }];
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.complete).toBe(true);
      expect(bundle.spots.map((d) => d.id)).toEqual(["s0", "s1"]);
    });

    it("keeps active spots and names spots as missing when the inactive read is refused (rules not deployed)", async () => {
      lists["spots?createdBy==u1?isActive==true"] = [{ id: "s1", data: { isActive: true } }];
      lists["spots?createdBy==u1?isActive==false"] = fsError("permission-denied");
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.complete).toBe(false);
      expect(bundle.missingSections).toEqual(["spots"]);
      expect(bundle.spots.map((d) => d.id)).toEqual(["s1"]);
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_collection_failed", {
        section: "spots.createdBy.isActive=false",
        code: "permission-denied",
      });
    });

    it("lists failed sections once each, in registry order", async () => {
      lists["appeals?appellantUid==u1"] = fsError("permission-denied");
      lists["games?judgeId==u1"] = fsError("unavailable");
      lists["games?player1Uid==u1"] = fsError("unavailable");
      docs["users/u1"] = fsError("unavailable");
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.missingSections).toEqual(["profile", "games", "appeals"]);
    });

    it("names the username section when its read fails", async () => {
      docs["usernames/sk8r"] = fsError("unavailable");
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.missingSections).toEqual(["usernameReservation"]);
      expect(bundle.usernameReservation).toBeNull();
    });

    it("logs a failure without a Firestore code as unknown", async () => {
      lists["clips?playerUid==u1"] = new Error("boom");
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.missingSections).toEqual(["clips"]);
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_collection_failed", {
        section: "clips",
        code: "unknown",
      });
    });

    it("sends partial files to Sentry and the log with labels and codes only", async () => {
      lists["games?player1Uid==u1"] = fsError("unavailable");
      docs["users/u1"] = fsError("permission-denied");

      await exportUserData(UID, "sk8r");

      expect(mockCaptureMessage).toHaveBeenCalledWith("user_data_export_partial", {
        level: "warning",
        extra: {
          missingSections: ["profile", "games"],
          truncatedSections: [],
          codes: { users: "permission-denied", "games.player1Uid": "unavailable" },
        },
      });
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_doc_failed", {
        section: "users",
        code: "permission-denied",
      });
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_collection_failed", {
        section: "games.player1Uid",
        code: "unavailable",
      });
      const logged = JSON.stringify([mockLoggerWarn.mock.calls, mockCaptureMessage.mock.calls]);
      expect(logged).not.toContain(UID);
      expect(logged).not.toContain("sk8r");
      expect(logged).not.toContain("secret path");
    });

    it("throws instead of making a near-empty file when nothing could be read", async () => {
      h.mockGetDoc.mockRejectedValue(fsError("unavailable"));
      h.mockGetDocs.mockRejectedValue(fsError("unavailable"));
      const err = await exportUserData(UID, "sk8r").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserDataExportError);
      expect((err as Error).message).toBe(EXPORT_FAILED_MESSAGE);
      expect((err as UserDataExportError).codes).toMatchObject({
        users: "unavailable",
        "games.player1Uid": "unavailable",
      });
    });

    it("still makes a file when only one read works", async () => {
      h.mockGetDocs.mockRejectedValue(fsError("unavailable"));
      h.mockGetDoc.mockImplementation(async (ref: { path: string }) => {
        if (ref.path === "users/u1") return { id: "u1", exists: () => true, data: () => ({ a: 1 }) };
        throw fsError("unavailable");
      });
      const bundle = await exportUserData(UID, "");
      expect(bundle.profile?.id).toBe("u1");
      expect(bundle.complete).toBe(false);
    });
  });

  describe("paging", () => {
    const fullPage = (prefix: string, page: number) =>
      Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: `${prefix}${page}-${i}`, data: {} }));

    it("pages with startAfter until a page comes back short", async () => {
      lists["notifications?recipientUid==u1"] = (page) => (page < 3 ? fullPage("n", page) : [{ id: "last", data: {} }]);
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.notifications).toHaveLength(2 * EXPORT_PAGE_SIZE + 1);
      expect(bundle.complete).toBe(true);
    });

    it("stops at the page ceiling and marks the list truncated instead of cutting it off silently", async () => {
      lists["notifications?recipientUid==u1"] = (page) => fullPage("n", page);
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.notifications).toHaveLength(EXPORT_MAX_PAGES * EXPORT_PAGE_SIZE);
      expect(bundle.truncatedSections).toEqual(["notifications"]);
      expect(bundle.capped).toBe(true);
      expect(mockLoggerWarn).toHaveBeenCalledWith("user_data_export_list_truncated", {
        section: "notifications",
        pages: EXPORT_MAX_PAGES,
      });
    });

    it("keeps the pages it got when a later page fails, and names the section", async () => {
      lists["notifications?recipientUid==u1"] = (page) => (page === 1 ? fullPage("n", 1) : fsError("unavailable"));
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.notifications).toHaveLength(EXPORT_PAGE_SIZE);
      expect(bundle.missingSections).toEqual(["notifications"]);
    });
  });

  describe("reads under each parent (drop claims and entries)", () => {
    it("keeps the claims it got and names the section when one get fails", async () => {
      lists["drops"] = [
        { id: "d1", data: {} },
        { id: "d2", data: {} },
      ];
      docs["drops/d1/claims/u1"] = { at: 1 };
      docs["drops/d2/claims/u1"] = fsError("unavailable");
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.dropClaims.map((d) => d.path)).toEqual(["drops/d1/claims/u1"]);
      expect(bundle.missingSections).toEqual(["dropClaims"]);
    });

    it("names both drop sections when the drop list can't be read", async () => {
      lists["drops"] = fsError("unavailable");
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.missingSections).toEqual(["dropClaims", "dropEntries"]);
    });

    it("marks them truncated when the drop list hits the ceiling", async () => {
      lists["drops"] = (page) =>
        Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: `d${page}-${i}`, data: {} }));
      const bundle = await exportUserData(UID, "sk8r");
      expect(bundle.truncatedSections).toEqual(["dropClaims", "dropEntries"]);
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
    // Three cooldown sections share one plain name: said once.
    [["notificationLimits", "reportLimits", "wallet"], "send and report cooldowns and Hubba Bucks balance"],
  ] as const)("%j reads as %j", (sections, expected) => {
    expect(describeMissingSections(sections)).toBe(expected);
  });
});

describe("what the file leaves out", () => {
  it("names every left-out collection that holds the user's data, from the registry", () => {
    expect(EXPORT_NOT_INCLUDED).toEqual([
      "daily closet limits",
      "dice game cooldown",
      "nudge cooldowns",
      "trick labels made from your clips",
      "your trick-training consent withdrawal",
      "your pro reviews",
    ]);
  });

  it("says so in plain words and points to the privacy contact", () => {
    expect(NOT_INCLUDED_NOTICE).toBe(
      "This file doesn't include daily closet limits, dice game cooldown, nudge cooldowns, trick labels made " +
        "from your clips, your trick-training consent withdrawal and your pro reviews. To get a copy of those, " +
        "email privacy@skatehubba.com.",
    );
  });

  it("is in an incomplete file too", async () => {
    lists["games?player2Uid==u1"] = fsError("unavailable");
    const bundle = await exportUserData(UID, "sk8r");
    expect(bundle.complete).toBe(false);
    expect(bundle.notIncluded).toEqual([...EXPORT_NOT_INCLUDED]);
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
    expect(userDataFilename(emptyBundle({ exportedAt: "2026-04-15T12:34:56.000Z" }))).toBe(
      "skatehubba-data-sk8r-2026-04-15.json",
    );
  });

  it("falls back to 'user' when username is empty", () => {
    expect(userDataFilename(emptyBundle({ subject: { uid: "u1", username: "" } }))).toBe(
      "skatehubba-data-user-2026-04-15.json",
    );
  });

  it("strips illegal filesystem characters from username", () => {
    expect(userDataFilename(emptyBundle({ subject: { uid: "u1", username: "sk8r/../etc" } }))).toBe(
      "skatehubba-data-sk8retc-2026-04-15.json",
    );
  });
});

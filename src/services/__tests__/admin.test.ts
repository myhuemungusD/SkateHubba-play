import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ──────────────────
 * admin.ts spans four write shapes (transaction update, setDoc, addDoc,
 * updateDoc), a delete and a filtered read, so the mock covers the whole
 * document API rather than the two-call surface achievements.test.ts needs.
 * `doc()`/`collection()` record their path segments so every assertion can
 * prove WHICH document a write landed on, not just that a write happened.
 */
const h = vi.hoisted(() => ({
  mockDoc: vi.fn((...args: unknown[]) => ({ __path: args.slice(1).join("/") })),
  mockCollection: vi.fn((...args: unknown[]) => ({ __path: args.slice(1).join("/") })),
  mockAddDoc: vi.fn(),
  mockSetDoc: vi.fn(),
  mockUpdateDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockQuery: vi.fn((...args: unknown[]) => ({ __query: args })),
  mockWhere: vi.fn((field: unknown, op: unknown, value: unknown) => ({ __where: { field, op, value } })),
  mockRunTransaction: vi.fn(),
  mockServerTimestamp: vi.fn(() => "SERVER_TS"),
}));

vi.mock("firebase/firestore", () => ({
  doc: h.mockDoc,
  collection: h.mockCollection,
  addDoc: h.mockAddDoc,
  setDoc: h.mockSetDoc,
  updateDoc: h.mockUpdateDoc,
  deleteDoc: h.mockDeleteDoc,
  getDocs: h.mockGetDocs,
  query: h.mockQuery,
  where: h.mockWhere,
  runTransaction: h.mockRunTransaction,
  serverTimestamp: h.mockServerTimestamp,
}));

vi.mock("../../firebase");

import {
  grantVerifiedPro,
  revokeVerifiedPro,
  awardAchievement,
  revokeAchievement,
  awardLockerItem,
  removeLockerItem,
  fetchReports,
  resolveReport,
  type AdminLockerItemInput,
} from "../admin";

const ADMIN = "admin-uid";
const TARGET = "skater-uid";

/** Errors classified permanent by `withRetry`, so the read path under test
 *  fails on the first attempt instead of sleeping through the backoff. */
function denied(): Error {
  return Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" });
}

/** The Transaction stub the service body actually received. */
interface ObservedTx {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

/**
 * Wire `runTransaction` for one call with a stub profile snapshot. Returns an
 * accessor for the Transaction the service saw so a test can assert the exact
 * payload it staged.
 */
function txWithProfile(exists: boolean): () => ObservedTx {
  let captured: ObservedTx | undefined;
  h.mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: ObservedTx) => Promise<void>) => {
    const tx: ObservedTx = {
      get: vi.fn().mockResolvedValue({ exists: () => exists }),
      update: vi.fn(),
    };
    captured = tx;
    await cb(tx);
  });
  return () => {
    if (!captured) throw new Error("transaction was never invoked");
    return captured;
  };
}

/** Duck-typed Timestamp stand-in — the parser detects `.toDate()` structurally. */
class FakeTimestamp {
  constructor(private readonly value: Date) {}
  toDate(): Date {
    return this.value;
  }
}

const FILED_2026 = new FakeTimestamp(new Date("2026-06-01T12:00:00Z"));
const FILED_2025 = new FakeTimestamp(new Date("2025-01-15T09:30:00Z"));

function reportDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

/**
 * The string half of a well-formed report. Shared by the doc stub and the
 * expected parse result so the mapping assertion below proves the values
 * survive the round-trip rather than restating them.
 */
const REPORT_FIELDS = {
  reporterUid: "reporter-1",
  reportedUid: TARGET,
  reportedUsername: "grindking",
  gameId: "game-9",
  reason: "cheating",
  description: "He landed on his knee and still claimed it.",
  clipId: "game-9_3_set",
  status: "pending",
};

/** A complete, well-formed report body. */
function fullReport(): Record<string, unknown> {
  return { ...REPORT_FIELDS, createdAt: FILED_2026 };
}

function stubReports(docs: unknown[]): void {
  h.mockGetDocs.mockResolvedValueOnce({ docs });
}

const LOCKER_ITEM: AdminLockerItemInput = {
  type: "deck",
  brand: "Hubba",
  name: "Gold Standard",
  imageUrl: "https://cdn.example/deck.png",
  rarity: "limited",
  provenanceReason: "Won the 2026 invitational",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.mockServerTimestamp.mockReturnValue("SERVER_TS");
  h.mockSetDoc.mockResolvedValue(undefined);
  h.mockUpdateDoc.mockResolvedValue(undefined);
  h.mockDeleteDoc.mockResolvedValue(undefined);
  h.mockAddDoc.mockResolvedValue({ id: "new-item-id" });
});

describe("grantVerifiedPro / revokeVerifiedPro", () => {
  it("writes exactly { isVerifiedPro, verifiedBy, verifiedAt } on users/{uid}", async () => {
    const observed = txWithProfile(true);

    await grantVerifiedPro(ADMIN, TARGET);

    expect(h.mockDoc).toHaveBeenCalledWith(expect.anything(), "users", TARGET);
    const tx = observed();
    // Payload exactness: the users update rule pins the affected key set, so an
    // extra or renamed field here is a runtime permission-denied, not a type error.
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ __path: `users/${TARGET}` }), {
      isVerifiedPro: true,
      verifiedBy: ADMIN,
      verifiedAt: "SERVER_TS",
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("mutates through runTransaction, never a bare update", async () => {
    txWithProfile(true);
    await grantVerifiedPro(ADMIN, TARGET);
    expect(h.mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(h.mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("reads the profile before staging the write", async () => {
    const observed = txWithProfile(true);
    await grantVerifiedPro(ADMIN, TARGET);
    expect(observed().get).toHaveBeenCalledWith(expect.objectContaining({ __path: `users/${TARGET}` }));
  });

  it("revoke clears the flag and re-stamps the audit fields with the revoking admin", async () => {
    const observed = txWithProfile(true);

    await revokeVerifiedPro("other-admin", TARGET);

    // A revocation is itself an audited admin act — verifiedBy/verifiedAt must
    // point at whoever took the status away, not stay on the original granter.
    expect(observed().update).toHaveBeenCalledWith(expect.anything(), {
      isVerifiedPro: false,
      verifiedBy: "other-admin",
      verifiedAt: "SERVER_TS",
    });
  });

  it("refuses to write when the target profile no longer exists", async () => {
    const observed = txWithProfile(false);
    await expect(grantVerifiedPro(ADMIN, TARGET)).rejects.toThrow(/no longer exists/);
    expect(observed().update).not.toHaveBeenCalled();
  });

  it("rethrows a rules rejection so the console can surface it", async () => {
    h.mockRunTransaction.mockRejectedValueOnce(denied());
    await expect(grantVerifiedPro(ADMIN, TARGET)).rejects.toThrow(/insufficient permissions/);
  });

  it.each([
    { label: "an empty admin uid", admin: "", target: TARGET },
    { label: "an empty target uid", admin: ADMIN, target: "" },
    { label: "a path-separated target uid", admin: ADMIN, target: "users/someone" },
    { label: "a non-string target uid", admin: ADMIN, target: undefined as unknown as string },
  ])("short-circuits $label without opening a transaction", async ({ admin, target }) => {
    await expect(grantVerifiedPro(admin, target)).rejects.toThrow(/Invalid/);
    expect(h.mockRunTransaction).not.toHaveBeenCalled();
  });

  it("short-circuits an invalid uid on revoke too", async () => {
    await expect(revokeVerifiedPro(ADMIN, "a/b")).rejects.toThrow(/Invalid target uid/);
    expect(h.mockRunTransaction).not.toHaveBeenCalled();
  });
});

describe("awardAchievement", () => {
  it("writes { earnedAt, reason } to users/{uid}/achievements/{badgeId}", async () => {
    await awardAchievement(TARGET, "century", "100 games played");

    expect(h.mockDoc).toHaveBeenCalledWith(expect.anything(), "users", TARGET, "achievements", "century");
    expect(h.mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ __path: `users/${TARGET}/achievements/century` }),
      {
        earnedAt: "SERVER_TS",
        reason: "100 games played",
      },
    );
  });

  it("trims the reason before it is written", async () => {
    await awardAchievement(TARGET, "og", "  day one  ");
    expect(h.mockSetDoc.mock.calls[0][1]).toEqual({ earnedAt: "SERVER_TS", reason: "day one" });
  });

  it.each([
    { label: "the target uid is blank", uid: "", badge: "og", reason: "day one" },
    { label: "the badge id has a path separator", uid: TARGET, badge: "og/extra", reason: "day one" },
    { label: "the reason is whitespace only", uid: TARGET, badge: "og", reason: "   " },
    { label: "the reason is not a string", uid: TARGET, badge: "og", reason: null as unknown as string },
  ])("throws without writing when $label", async ({ uid, badge, reason }) => {
    await expect(awardAchievement(uid, badge, reason)).rejects.toThrow(/Invalid/);
    expect(h.mockSetDoc).not.toHaveBeenCalled();
  });

  it("rejects a reason past the rules' 200-character cap before the round-trip", async () => {
    // The rule caps reason.size() at 200; failing here gives the moderator a
    // legible message instead of an opaque permission-denied.
    await expect(awardAchievement(TARGET, "og", "x".repeat(201))).rejects.toThrow(/200 characters or fewer/);
    expect(h.mockSetDoc).not.toHaveBeenCalled();
  });

  it("accepts a reason exactly at the cap", async () => {
    await awardAchievement(TARGET, "og", "x".repeat(200));
    expect(h.mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it("rethrows a write failure", async () => {
    h.mockSetDoc.mockRejectedValueOnce(denied());
    await expect(awardAchievement(TARGET, "og", "day one")).rejects.toThrow(/insufficient permissions/);
  });
});

describe("revokeAchievement", () => {
  it("deletes users/{uid}/achievements/{badgeId}", async () => {
    await revokeAchievement(TARGET, "century");
    expect(h.mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ __path: `users/${TARGET}/achievements/century` }),
    );
  });

  it.each([
    { label: "target uid", uid: "", badge: "century" },
    { label: "badge id", uid: TARGET, badge: "" },
  ])("throws on an invalid $label without deleting", async ({ uid, badge }) => {
    await expect(revokeAchievement(uid, badge)).rejects.toThrow(/Invalid/);
    expect(h.mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("rethrows a delete failure", async () => {
    h.mockDeleteDoc.mockRejectedValueOnce(denied());
    await expect(revokeAchievement(TARGET, "century")).rejects.toThrow(/insufficient permissions/);
  });
});

describe("awardLockerItem", () => {
  it("adds the item to users/{uid}/locker with a nested provenance map", async () => {
    const id = await awardLockerItem(TARGET, LOCKER_ITEM);

    expect(h.mockCollection).toHaveBeenCalledWith(expect.anything(), "users", TARGET, "locker");
    // Payload exactness: `provenance` is a MAP, not a flat provenanceReason —
    // the rules field guard and fetchLockerItems both read provenance.reason.
    expect(h.mockAddDoc).toHaveBeenCalledWith(expect.objectContaining({ __path: `users/${TARGET}/locker` }), {
      type: "deck",
      brand: "Hubba",
      name: "Gold Standard",
      imageUrl: "https://cdn.example/deck.png",
      rarity: "limited",
      acquiredAt: "SERVER_TS",
      provenance: { reason: "Won the 2026 invitational" },
    });
    expect(id).toBe("new-item-id");
  });

  it("stores a null imageUrl rather than an empty string", async () => {
    // An empty `src` makes browsers re-request the current page instead of
    // rendering the fallback tile.
    await awardLockerItem(TARGET, { ...LOCKER_ITEM, imageUrl: "   " });
    expect(h.mockAddDoc.mock.calls[0][1]).toMatchObject({ imageUrl: null });
  });

  it("keeps an explicit null imageUrl", async () => {
    await awardLockerItem(TARGET, { ...LOCKER_ITEM, imageUrl: null });
    expect(h.mockAddDoc.mock.calls[0][1]).toMatchObject({ imageUrl: null });
  });

  it("trims the free-text fields", async () => {
    await awardLockerItem(TARGET, {
      type: " wheels ",
      brand: " Spitfire ",
      name: " Formula Four ",
      imageUrl: " https://cdn.example/w.png ",
      rarity: " rare ",
      provenanceReason: " Comp prize ",
    });
    expect(h.mockAddDoc.mock.calls[0][1]).toEqual({
      type: "wheels",
      brand: "Spitfire",
      name: "Formula Four",
      imageUrl: "https://cdn.example/w.png",
      rarity: "rare",
      acquiredAt: "SERVER_TS",
      provenance: { reason: "Comp prize" },
    });
  });

  it("degrades a non-string brand to an empty string", async () => {
    // The read mapper renders "" fine; a stray non-string would fail the rule.
    await awardLockerItem(TARGET, { ...LOCKER_ITEM, brand: undefined as unknown as string });
    expect(h.mockAddDoc.mock.calls[0][1]).toMatchObject({ brand: "" });
  });

  it.each([
    { label: "target uid", uid: "users/x", patch: {} },
    { label: "type", uid: TARGET, patch: { type: "" } },
    { label: "name", uid: TARGET, patch: { name: "  " } },
    { label: "rarity", uid: TARGET, patch: { rarity: "" } },
    { label: "provenance reason", uid: TARGET, patch: { provenanceReason: "" } },
  ])("throws on an invalid $label without minting", async ({ uid, patch }) => {
    await expect(awardLockerItem(uid, { ...LOCKER_ITEM, ...patch })).rejects.toThrow(/Invalid/);
    expect(h.mockAddDoc).not.toHaveBeenCalled();
  });

  it.each([
    { label: "type", patch: { type: "x".repeat(101) }, cap: 100 },
    { label: "brand", patch: { brand: "x".repeat(101) }, cap: 100 },
    { label: "name", patch: { name: "x".repeat(101) }, cap: 100 },
    { label: "rarity", patch: { rarity: "x".repeat(101) }, cap: 100 },
    { label: "provenance reason", patch: { provenanceReason: "x".repeat(201) }, cap: 200 },
  ])("rejects an over-long $label before the round-trip", async ({ patch, cap }) => {
    // Mirrors the size() caps on the locker create rule.
    await expect(awardLockerItem(TARGET, { ...LOCKER_ITEM, ...patch })).rejects.toThrow(
      new RegExp(`${cap} characters or fewer`),
    );
    expect(h.mockAddDoc).not.toHaveBeenCalled();
  });

  it("accepts fields exactly at their caps", async () => {
    await awardLockerItem(TARGET, {
      ...LOCKER_ITEM,
      brand: "b".repeat(100),
      name: "n".repeat(100),
      provenanceReason: "p".repeat(200),
    });
    expect(h.mockAddDoc).toHaveBeenCalledTimes(1);
  });

  it("rethrows a mint failure", async () => {
    h.mockAddDoc.mockRejectedValueOnce(denied());
    await expect(awardLockerItem(TARGET, LOCKER_ITEM)).rejects.toThrow(/insufficient permissions/);
  });
});

describe("removeLockerItem", () => {
  it("deletes users/{uid}/locker/{itemId}", async () => {
    await removeLockerItem(TARGET, "item-7");
    expect(h.mockDeleteDoc).toHaveBeenCalledWith(expect.objectContaining({ __path: `users/${TARGET}/locker/item-7` }));
  });

  it.each([
    { label: "target uid", uid: "", itemId: "item-7" },
    { label: "item id", uid: TARGET, itemId: "a/b" },
  ])("throws on an invalid $label without deleting", async ({ uid, itemId }) => {
    await expect(removeLockerItem(uid, itemId)).rejects.toThrow(/Invalid/);
    expect(h.mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("rethrows a delete failure", async () => {
    h.mockDeleteDoc.mockRejectedValueOnce(denied());
    await expect(removeLockerItem(TARGET, "item-7")).rejects.toThrow(/insufficient permissions/);
  });
});

describe("fetchReports — query shape", () => {
  it("reads the whole reports collection when no filter is given", async () => {
    stubReports([reportDoc("r1", fullReport())]);

    await fetchReports();

    expect(h.mockCollection).toHaveBeenCalledWith(expect.anything(), "reports");
    expect(h.mockWhere).not.toHaveBeenCalled();
    expect(h.mockGetDocs).toHaveBeenCalledWith(expect.objectContaining({ __path: "reports" }));
  });

  it("narrows server-side on the status filter", async () => {
    stubReports([]);

    await fetchReports("pending");

    expect(h.mockWhere).toHaveBeenCalledWith("status", "==", "pending");
    expect(h.mockQuery).toHaveBeenCalledTimes(1);
  });

  it("treats a blank filter as no filter", async () => {
    stubReports([]);
    await fetchReports("");
    expect(h.mockWhere).not.toHaveBeenCalled();
  });

  it("adds no Firestore orderBy — undated reports must survive the query", async () => {
    stubReports([reportDoc("r1", { ...fullReport(), createdAt: undefined })]);

    const [report] = await fetchReports();

    // A server-side orderBy("createdAt") would have dropped this doc entirely.
    expect(report.id).toBe("r1");
    expect(report.createdAt).toBeNull();
  });

  it("propagates transport failures so the console can offer a retry", async () => {
    h.mockGetDocs.mockRejectedValueOnce(denied());
    await expect(fetchReports("pending")).rejects.toThrow(/insufficient permissions/);
  });
});

describe("fetchReports — parsing", () => {
  it("maps every field of a well-formed report", async () => {
    stubReports([reportDoc("r1", fullReport())]);

    await expect(fetchReports()).resolves.toEqual([
      { id: "r1", ...REPORT_FIELDS, createdAt: new Date("2026-06-01T12:00:00Z"), resolvedBy: "", resolvedAt: null },
    ]);
  });

  it("returns an empty array when the queue is empty", async () => {
    stubReports([]);
    await expect(fetchReports()).resolves.toEqual([]);
  });

  it("keeps unrecognised reason and status values instead of dropping the row", async () => {
    // A report the client can't classify is exactly the one a moderator needs.
    stubReports([reportDoc("r1", { ...fullReport(), reason: "future_reason", status: "escalated" })]);

    const [report] = await fetchReports();

    expect(report.reason).toBe("future_reason");
    expect(report.status).toBe("escalated");
  });

  it("degrades missing or mistyped string fields to empty strings, and gameId to null", async () => {
    stubReports([reportDoc("r1", { createdAt: FILED_2026, reportedUid: 42, gameId: null })]);

    const [report] = await fetchReports();

    expect(report).toEqual({
      id: "r1",
      reporterUid: "",
      reportedUid: "",
      reportedUsername: "",
      // gameId is optional now (a user-clip report has no game), so absence
      // reads as null rather than "" — the queue branches on presence.
      gameId: null,
      reason: "",
      description: "",
      clipId: null,
      status: "",
      createdAt: new Date("2026-06-01T12:00:00Z"),
      resolvedBy: "",
      resolvedAt: null,
    });
  });

  it("ignores unknown/extra server fields", async () => {
    stubReports([reportDoc("r1", { ...fullReport(), reviewerNotes: "internal", severity: 3 })]);

    const [report] = await fetchReports();

    expect(Object.keys(report).sort()).toEqual([
      "clipId",
      "createdAt",
      "description",
      "gameId",
      "id",
      "reason",
      "reportedUid",
      "reportedUsername",
      "reporterUid",
      "resolvedAt",
      "resolvedBy",
      "status",
    ]);
  });

  it("surfaces the resolution audit pair written by resolveReport", async () => {
    stubReports([
      reportDoc("r1", {
        ...fullReport(),
        status: "resolved",
        resolvedBy: "admin-7",
        resolvedAt: FILED_2025,
      }),
    ]);

    const [report] = await fetchReports();

    expect(report.resolvedBy).toBe("admin-7");
    expect(report.resolvedAt).toEqual(new Date("2025-01-15T09:30:00Z"));
  });

  it("degrades a mistyped resolvedBy/resolvedAt to the pending sentinels", async () => {
    stubReports([reportDoc("r1", { ...fullReport(), resolvedBy: 42, resolvedAt: "yesterday" })]);

    const [report] = await fetchReports();

    expect(report.resolvedBy).toBe("");
    expect(report.resolvedAt).toBeNull();
  });

  it("carries the reporter's description through verbatim", async () => {
    // The queue exists to show a moderator what was written. Newlines and
    // markup-looking text must survive the read intact — the UI renders it as
    // plain text, and trimming or escaping here would hide the evidence.
    const description = "First he claimed it.\nThen <b>he</b> said the camera lagged.";
    stubReports([reportDoc("r1", { ...fullReport(), description })]);

    const [report] = await fetchReports();

    expect(report.description).toBe(description);
  });

  it.each([
    { label: "missing", description: undefined },
    { label: "null", description: null },
    { label: "a non-string", description: 42 },
  ])("degrades a $label description to an empty string", async ({ description }) => {
    stubReports([reportDoc("r1", { ...fullReport(), description })]);

    const [report] = await fetchReports();

    expect(report.description).toBe("");
  });

  it("keeps the clipId when the report targets a single clip", async () => {
    stubReports([reportDoc("r1", { ...fullReport(), clipId: "game-9_3_match" })]);

    const [report] = await fetchReports();

    expect(report.clipId).toBe("game-9_3_match");
  });

  it.each([
    { label: "the optional field is absent", clipId: undefined },
    { label: "it is null", clipId: null },
    { label: "it is blank", clipId: "   " },
    { label: "it is a non-string", clipId: 7 },
  ])("yields a null clipId when $label", async ({ clipId }) => {
    stubReports([reportDoc("r1", { ...fullReport(), clipId })]);

    const [report] = await fetchReports();

    expect(report.clipId).toBeNull();
  });

  it.each([
    { label: "the field is missing", createdAt: undefined },
    { label: "the field is a primitive", createdAt: "2026-06-01" },
    { label: "toDate is not callable", createdAt: { toDate: "nope" } },
    { label: "toDate returns a non-Date", createdAt: { toDate: () => 1750000000000 } },
    { label: "toDate returns an invalid Date", createdAt: { toDate: () => new Date("not-a-date") } },
  ])("yields a null createdAt when $label", async ({ createdAt }) => {
    stubReports([reportDoc("r1", { ...fullReport(), createdAt })]);
    const [report] = await fetchReports();
    expect(report.createdAt).toBeNull();
  });

  it.each([
    { label: "data() is empty", bad: { id: "empty", data: () => undefined } },
    { label: "data() is not an object", bad: { id: "primitive", data: () => "corrupt" } },
    { label: "the id is not a string", bad: { id: 7 as unknown as string, data: () => fullReport() } },
    { label: "the id is blank", bad: { id: "", data: () => fullReport() } },
  ])("skips — never blanks the queue for — a doc whose $label", async ({ bad }) => {
    stubReports([bad, reportDoc("good", fullReport())]);
    const result = await fetchReports();
    expect(result.map((r) => r.id)).toEqual(["good"]);
  });

  it("skips — rather than rethrows — a doc that throws while parsing", async () => {
    stubReports([
      {
        id: "explosive",
        data: () => ({
          createdAt: {
            toDate: () => {
              throw new Error("corrupt timestamp");
            },
          },
        }),
      },
      reportDoc("good", fullReport()),
    ]);

    const result = await fetchReports();

    expect(result.map((r) => r.id)).toEqual(["good"]);
  });
});

describe("fetchReports — ordering", () => {
  it("orders by createdAt descending", async () => {
    stubReports([
      reportDoc("older", { ...fullReport(), createdAt: FILED_2025 }),
      reportDoc("newer", { ...fullReport(), createdAt: FILED_2026 }),
      reportDoc("oldest", { ...fullReport(), createdAt: new FakeTimestamp(new Date("2024-03-03T00:00:00Z")) }),
    ]);

    const result = await fetchReports();

    expect(result.map((r) => r.id)).toEqual(["newer", "older", "oldest"]);
  });

  it.each([
    { label: "listed first", docs: ["undated", "dated"] },
    { label: "listed last", docs: ["dated", "undated"] },
  ])("keeps undated reports last when $label", async ({ docs }) => {
    stubReports(
      docs.map((id) => reportDoc(id, id === "dated" ? fullReport() : { ...fullReport(), createdAt: undefined })),
    );

    const result = await fetchReports();

    expect(result.map((r) => r.id)).toEqual(["dated", "undated"]);
  });
});

describe("resolveReport", () => {
  it("writes exactly { status, resolvedBy, resolvedAt } on reports/{id}", async () => {
    await resolveReport(ADMIN, "r1", "resolved");

    expect(h.mockDoc).toHaveBeenCalledWith(expect.anything(), "reports", "r1");
    expect(h.mockUpdateDoc).toHaveBeenCalledWith(expect.objectContaining({ __path: "reports/r1" }), {
      status: "resolved",
      resolvedBy: ADMIN,
      resolvedAt: "SERVER_TS",
    });
  });

  it("writes the dismissed status verbatim", async () => {
    await resolveReport(ADMIN, "r1", "dismissed");
    expect(h.mockUpdateDoc.mock.calls[0][1]).toMatchObject({ status: "dismissed" });
  });

  it("refuses a status outside the allowlist", async () => {
    // A JS caller (or a drifted UI constant) writing an unknown status would
    // strand the report outside every queue filter.
    await expect(resolveReport(ADMIN, "r1", "archived" as "resolved")).rejects.toThrow(/Invalid report status/);
    expect(h.mockUpdateDoc).not.toHaveBeenCalled();
  });

  it.each([
    { label: "admin uid", admin: "", reportId: "r1" },
    { label: "report id", admin: ADMIN, reportId: "reports/r1" },
  ])("throws on an invalid $label without writing", async ({ admin, reportId }) => {
    await expect(resolveReport(admin, reportId, "resolved")).rejects.toThrow(/Invalid/);
    expect(h.mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("rethrows a write failure", async () => {
    h.mockUpdateDoc.mockRejectedValueOnce(denied());
    await expect(resolveReport(ADMIN, "r1", "resolved")).rejects.toThrow(/insufficient permissions/);
  });
});

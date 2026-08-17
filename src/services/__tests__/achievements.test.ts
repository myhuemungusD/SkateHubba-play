import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ──────────────────
 * `fetchAchievements` only touches collection() + getDocs(), so the mock
 * surface stays deliberately tiny: collection() records its path segments and
 * returns them as an opaque token, getDocs() is stubbed per-test.
 */
const { mockGetDocs, mockCollection } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockCollection: vi.fn((...args: unknown[]) => ({ path: args.slice(1).join("/") })),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  getDocs: mockGetDocs,
}));

vi.mock("../../firebase");

import { fetchAchievements } from "../achievements";

const UID = "skater-uid";

/**
 * Duck-typed stand-in for a Firestore Timestamp. The service detects
 * timestamps structurally via `.toDate()` rather than `instanceof Timestamp`,
 * so SDK class identity is irrelevant here.
 */
class FakeTimestamp {
  constructor(private readonly value: Date) {}
  toDate(): Date {
    return this.value;
  }
}

const EARNED_2026 = new FakeTimestamp(new Date("2026-06-01T12:00:00Z"));
const EARNED_2025 = new FakeTimestamp(new Date("2025-01-15T09:30:00Z"));

function badgeDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

/** Feed the next getDocs() call an arbitrary set of doc snapshots. */
function stubDocs(docs: unknown[]): void {
  mockGetDocs.mockResolvedValueOnce({ docs });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchAchievements — reads", () => {
  it("reads users/{uid}/achievements and maps every field", async () => {
    stubDocs([badgeDoc("century", { earnedAt: EARNED_2026, reason: "100 games played" })]);

    const result = await fetchAchievements(UID);

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "users", UID, "achievements");
    expect(result).toEqual([{ id: "century", earnedAt: new Date("2026-06-01T12:00:00Z"), reason: "100 games played" }]);
  });

  it("returns an empty array for a user with no badges", async () => {
    stubDocs([]);
    await expect(fetchAchievements(UID)).resolves.toEqual([]);
  });

  it("ignores unknown/extra server fields", async () => {
    stubDocs([badgeDoc("og", { earnedAt: EARNED_2025, reason: "day one", tier: "gold", xp: 400 })]);

    const [badge] = await fetchAchievements(UID);

    expect(Object.keys(badge).sort()).toEqual(["earnedAt", "id", "reason"]);
  });

  it("propagates transport failures so the caller can offer a retry", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" });
    mockGetDocs.mockRejectedValueOnce(denied);

    await expect(fetchAchievements(UID)).rejects.toThrow(/insufficient permissions/);
  });
});

describe("fetchAchievements — uid validation", () => {
  it("short-circuits an empty uid without hitting Firestore", async () => {
    await expect(fetchAchievements("")).resolves.toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("short-circuits a non-string uid without hitting Firestore", async () => {
    await expect(fetchAchievements(undefined as unknown as string)).resolves.toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("short-circuits a uid containing a path separator", async () => {
    await expect(fetchAchievements("users/other-uid")).resolves.toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});

describe("fetchAchievements — timestamp conversion", () => {
  it("converts a Firestore Timestamp into a Date", async () => {
    stubDocs([badgeDoc("streak10", { earnedAt: EARNED_2025, reason: "ten in a row" })]);
    const [badge] = await fetchAchievements(UID);
    expect(badge.earnedAt).toBeInstanceOf(Date);
    expect(badge.earnedAt?.toISOString()).toBe("2025-01-15T09:30:00.000Z");
  });

  it.each([
    { label: "the field is missing", earnedAt: undefined },
    { label: "the field is a primitive", earnedAt: "2026-06-01" },
    { label: "toDate is not callable", earnedAt: { toDate: "nope" } },
    { label: "toDate returns a non-Date", earnedAt: { toDate: () => 1750000000000 } },
    { label: "toDate returns an invalid Date", earnedAt: { toDate: () => new Date("not-a-date") } },
  ])("yields a null earnedAt when $label", async ({ earnedAt }) => {
    stubDocs([badgeDoc("pioneer", { earnedAt, reason: "early adopter" })]);
    const [badge] = await fetchAchievements(UID);
    expect(badge.earnedAt).toBeNull();
    expect(badge.id).toBe("pioneer");
  });

  it("yields a null reason when the field is missing or not a string", async () => {
    stubDocs([badgeDoc("club150", { earnedAt: EARNED_2026 }), badgeDoc("og", { earnedAt: EARNED_2026, reason: 42 })]);
    const result = await fetchAchievements(UID);
    expect(result.map((b) => b.reason)).toEqual([null, null]);
  });
});

describe("fetchAchievements — malformed docs", () => {
  it("skips a doc whose data() is empty", async () => {
    stubDocs([badgeDoc("good", { earnedAt: EARNED_2026 }), { id: "empty", data: () => undefined }]);
    const result = await fetchAchievements(UID);
    expect(result.map((b) => b.id)).toEqual(["good"]);
  });

  it("skips a doc whose data() is not an object", async () => {
    stubDocs([{ id: "primitive", data: () => "corrupt" }, badgeDoc("good", { earnedAt: EARNED_2026 })]);
    const result = await fetchAchievements(UID);
    expect(result.map((b) => b.id)).toEqual(["good"]);
  });

  it("skips a doc with an unusable id", async () => {
    stubDocs([
      { id: 7 as unknown as string, data: () => ({ reason: "numeric id" }) },
      { id: "", data: () => ({ reason: "blank id" }) },
      badgeDoc("good", { earnedAt: EARNED_2026 }),
    ]);
    const result = await fetchAchievements(UID);
    expect(result.map((b) => b.id)).toEqual(["good"]);
  });

  it("skips — rather than rethrows — a doc that throws while parsing", async () => {
    stubDocs([
      {
        id: "explosive",
        data: () => ({
          earnedAt: {
            toDate: () => {
              throw new Error("corrupt timestamp");
            },
          },
        }),
      },
      badgeDoc("good", { earnedAt: EARNED_2026 }),
    ]);

    const result = await fetchAchievements(UID);

    expect(result.map((b) => b.id)).toEqual(["good"]);
  });
});

describe("fetchAchievements — ordering", () => {
  it("orders by earnedAt descending", async () => {
    stubDocs([
      badgeDoc("older", { earnedAt: EARNED_2025 }),
      badgeDoc("newer", { earnedAt: EARNED_2026 }),
      badgeDoc("oldest", { earnedAt: new FakeTimestamp(new Date("2024-03-03T00:00:00Z")) }),
    ]);

    const result = await fetchAchievements(UID);

    expect(result.map((b) => b.id)).toEqual(["newer", "older", "oldest"]);
  });

  it("keeps undated badges last when they are listed first", async () => {
    stubDocs([badgeDoc("undated", {}), badgeDoc("dated", { earnedAt: EARNED_2026 })]);
    const result = await fetchAchievements(UID);
    expect(result.map((b) => b.id)).toEqual(["dated", "undated"]);
  });

  it("keeps undated badges last when they are listed last", async () => {
    stubDocs([badgeDoc("dated", { earnedAt: EARNED_2026 }), badgeDoc("undated", {})]);
    const result = await fetchAchievements(UID);
    expect(result.map((b) => b.id)).toEqual(["dated", "undated"]);
  });

  it("does not add a Firestore orderBy — undated docs must survive the query", async () => {
    stubDocs([badgeDoc("undated", { reason: "granted before the field existed" })]);

    const result = await fetchAchievements(UID);

    // A server-side orderBy("earnedAt") would have dropped this doc entirely.
    expect(result).toEqual([{ id: "undated", earnedAt: null, reason: "granted before the field existed" }]);
  });
});

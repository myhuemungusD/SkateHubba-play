import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), warn: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  collection: (_db: unknown, ...p: string[]) => p.join("/"),
  documentId: () => "__id__",
  where: (...a: unknown[]) => ({ where: a }),
  orderBy: (...a: unknown[]) => ({ orderBy: a }),
  limit: (n: number) => ({ limit: n }),
  query: (...a: unknown[]) => a,
  getDoc: h.getDoc,
  getDocs: h.getDocs,
}));
vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));

import { getFeatureTesterUids, getUserSummary, listBans, searchUsers } from "../admin.console";

const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const qd = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

beforeEach(() => vi.clearAllMocks());

describe("listBans", () => {
  it("maps bans with usernames, caching lookups and tolerating failures", async () => {
    h.getDocs.mockResolvedValue({
      docs: [
        qd("u1", { bannedBy: "a1", reason: "spam", bannedAt: { toMillis: () => 5 } }),
        qd("u2", { bannedBy: "a1" }),
        qd("u3", { bannedBy: "" }),
        qd("u4", { bannedBy: "zz" }),
      ],
    });
    h.getDoc.mockImplementation(async (path: string) => {
      if (path === "users/u1") return snap({ username: "kid" });
      if (path === "users/a1") return snap({ username: "boss" });
      if (path === "users/zz") throw new Error("x");
      if (path === "users/u3") return snap({});
      return snap(null);
    });
    const rows = await listBans();
    expect(rows[0]).toEqual({
      uid: "u1",
      username: "kid",
      bannedBy: "a1",
      bannedByUsername: "boss",
      reason: "spam",
      bannedAtMs: 5,
    });
    expect(rows[1]).toMatchObject({ username: "", bannedByUsername: "boss", reason: "", bannedAtMs: null });
    expect(rows[2]).toMatchObject({ bannedByUsername: "" });
    expect(rows[3]).toMatchObject({ bannedByUsername: "" });
    expect(h.getDoc.mock.calls.filter((c) => c[0] === "users/a1")).toHaveLength(1);
  });
});

describe("searchUsers", () => {
  it("returns [] for an empty term", async () => {
    expect(await searchUsers("  @ ")).toEqual([]);
    expect(h.getDocs).not.toHaveBeenCalled();
  });
  it("prefix-searches usernames and drops rows without a uid", async () => {
    h.getDocs.mockResolvedValue({ docs: [qd("mike", { uid: "m" }), qd("bad", {})] });
    expect(await searchUsers("@Mi")).toEqual([{ uid: "m", username: "mike" }]);
    expect(h.getDocs.mock.calls[0][0]).toContainEqual({ where: ["__id__", ">=", "mi"] });
  });
});

describe("getUserSummary", () => {
  it("returns null without a profile", async () => {
    h.getDoc.mockResolvedValue(snap(null));
    expect(await getUserSummary("x")).toBeNull();
  });
  it("summarizes record, reports, badges and ban state", async () => {
    h.getDoc.mockImplementation(async (p: string) =>
      p === "users/u" ? snap({ username: "u", wins: 3, losses: Infinity, isVerifiedPro: true }) : snap({}),
    );
    h.getDocs.mockImplementation(async (q: unknown) =>
      Array.isArray(q) ? { docs: [qd("r1", { status: "pending" }), qd("r2", { status: "resolved" })] } : { size: 4 },
    );
    expect(await getUserSummary("u")).toEqual({
      uid: "u",
      username: "u",
      wins: 3,
      losses: 0,
      isVerifiedPro: true,
      isBanned: true,
      reportsAgainst: 2,
      openReportsAgainst: 1,
      badges: 4,
    });
  });
  it("degrades when sub-reads fail", async () => {
    h.getDoc.mockImplementation(async (p: string) => {
      if (p === "users/u") return snap({ banned: true });
      throw new Error("no");
    });
    h.getDocs.mockRejectedValueOnce("denied").mockRejectedValueOnce(new Error("x"));
    expect(await getUserSummary("u")).toMatchObject({ isBanned: true, reportsAgainst: 0, badges: 0, username: "" });
    expect(h.warn).toHaveBeenCalledWith("admin_summary_reports_failed", { error: "denied" });
  });
  it("reports not banned when neither tombstone nor mirror is set", async () => {
    h.getDoc.mockImplementation(async (p: string) => (p === "users/u" ? snap({}) : snap(null)));
    h.getDocs.mockResolvedValue({ docs: [], size: 0 });
    expect(await getUserSummary("u")).toMatchObject({ isBanned: false, isVerifiedPro: false });
  });
});

describe("getFeatureTesterUids", () => {
  it("returns string uids", async () => {
    h.getDoc.mockResolvedValue(snap({ uids: ["a", 1, "b"] }));
    expect(await getFeatureTesterUids()).toEqual(["a", "b"]);
  });
  it("returns [] when missing or malformed", async () => {
    h.getDoc.mockResolvedValueOnce(snap(null)).mockResolvedValueOnce(snap({ uids: "x" }));
    expect(await getFeatureTesterUids()).toEqual([]);
    expect(await getFeatureTesterUids()).toEqual([]);
  });
  it("logs and returns [] on Error and non-Error failures", async () => {
    h.getDoc.mockRejectedValueOnce(new Error("d")).mockRejectedValueOnce("s");
    expect(await getFeatureTesterUids()).toEqual([]);
    expect(await getFeatureTesterUids()).toEqual([]);
    expect(h.warn).toHaveBeenCalledWith("admin_feature_testers_failed", { error: "s" });
  });
});

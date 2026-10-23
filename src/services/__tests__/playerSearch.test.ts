import { describe, it, expect, vi, beforeEach } from "vitest";

type AnyMock = (...args: unknown[]) => unknown;
const mockGetDocs = vi.fn<AnyMock>();
const mockCollection = vi.fn<AnyMock>((..._args) => (_args.slice(1) as string[]).join("/"));
const mockWhere = vi.fn<AnyMock>((...args) => ({ where: args }));
const mockLimit = vi.fn<AnyMock>((n) => ({ limit: n }));
const mockQuery = vi.fn<AnyMock>((...args) => ({ query: args }));
const mockGetUserProfile = vi.fn<AnyMock>();

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  documentId: () => "__name__",
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
}));
vi.mock("../../firebase");
vi.mock("../users", () => ({ getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args) }));

import { PREFIX_SEARCH_LIMIT, searchPlayersByPrefix } from "../playerSearch";

const snap = (rows: { id: string; uid?: unknown }[]) => ({
  docs: rows.map((r) => ({ id: r.id, data: () => (r.uid === undefined ? {} : { uid: r.uid }) })),
});
const profile = (uid: string) => ({ uid, username: `name_${uid}`, stance: "regular", createdAt: null });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserProfile.mockImplementation(async (uid) => profile(uid as string));
});

describe("searchPlayersByPrefix", () => {
  it("range-queries usernames doc ids with the lowercased prefix and maps uids to profiles", async () => {
    mockGetDocs.mockResolvedValueOnce(
      snap([
        { id: "oldhead", uid: "u1" },
        { id: "oldie", uid: "u2" },
      ]),
    );
    const out = await searchPlayersByPrefix("  @OldH ");
    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "usernames");
    expect(mockWhere).toHaveBeenCalledWith("__name__", ">=", "oldh");
    expect(mockWhere).toHaveBeenCalledWith("__name__", "<", "oldh\uf8ff");
    expect(mockLimit).toHaveBeenCalledWith(PREFIX_SEARCH_LIMIT);
    expect(out.map((p) => p.uid)).toEqual(["u1", "u2"]);
  });

  it("returns [] without a read for input that can't be a handle", async () => {
    for (const bad of ["", "   ", "@", "a b", "café", "x".repeat(21)]) {
      expect(await searchPlayersByPrefix(bad)).toEqual([]);
    }
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("drops excluded uids, malformed reservations, duplicates and stale handles", async () => {
    mockGetDocs.mockResolvedValueOnce(
      snap([
        { id: "sk8_me", uid: "me" },
        { id: "sk8_blocked", uid: "blocked" },
        { id: "sk8_bad" },
        { id: "sk8_num", uid: 42 },
        { id: "sk8_a", uid: "a" },
        { id: "sk8_a2", uid: "a" },
        { id: "sk8_gone", uid: "gone" },
      ]),
    );
    mockGetUserProfile.mockImplementation(async (uid) => (uid === "gone" ? null : profile(uid as string)));
    const out = await searchPlayersByPrefix("sk8", new Set(["me", "blocked"]));
    expect(mockLimit).toHaveBeenCalledWith(PREFIX_SEARCH_LIMIT + 2);
    expect(out.map((p) => p.uid)).toEqual(["a"]);
    expect(mockGetUserProfile).toHaveBeenCalledTimes(2);
  });

  it("caps profile reads at max and the query limit at 50", async () => {
    mockGetDocs.mockResolvedValueOnce(
      snap([
        { id: "a1", uid: "1" },
        { id: "a2", uid: "2" },
        { id: "a3", uid: "3" },
      ]),
    );
    const many = new Set(Array.from({ length: 60 }, (_, i) => `x${i}`));
    const out = await searchPlayersByPrefix("a", many, 2);
    expect(mockLimit).toHaveBeenCalledWith(50);
    expect(out.map((p) => p.uid)).toEqual(["1", "2"]);
  });
});

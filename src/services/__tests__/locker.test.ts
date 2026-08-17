import { describe, it, expect, vi, beforeEach } from "vitest";

type AnyMock = (...args: unknown[]) => unknown;

// fetchLockerItems is a pure read: collection() + getDocs() is the whole
// Firestore surface it needs.
const mockGetDocs = vi.fn<AnyMock>();
const mockCollection = vi.fn<AnyMock>((..._args) => (_args.slice(1) as string[]).join("/"));

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}));

vi.mock("../../firebase");

import { fetchLockerItems } from "../locker";

const UID = "gear-owner";

// Structural Firestore Timestamp — the parser reads `.toDate()` and never
// checks class identity, so this is indistinguishable from the real thing.
class StubTimestamp {
  constructor(private readonly when: Date) {}
  toDate(): Date {
    return this.when;
  }
}

const ACQUIRED_MAY = new StubTimestamp(new Date("2026-05-20T18:00:00Z"));
const ACQUIRED_JAN = new StubTimestamp(new Date("2026-01-02T08:00:00Z"));

/** A complete, well-formed locker doc; `overrides` patch individual fields. */
function itemDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      type: "deck",
      brand: "Baker",
      name: "Hubba Cruiser",
      imageUrl: "https://cdn.example.com/deck.png",
      rarity: "rare",
      acquiredAt: ACQUIRED_MAY,
      provenance: { reason: "Won the Hollenbeck bracket", grantedBy: "system" },
      ...overrides,
    }),
  };
}

function nextSnapshot(docs: unknown[]): void {
  mockGetDocs.mockResolvedValueOnce({ docs });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchLockerItems — reads", () => {
  it("reads users/{uid}/locker and maps the full item shape", async () => {
    nextSnapshot([itemDoc("deck-001")]);

    const items = await fetchLockerItems(UID);

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "users", UID, "locker");
    expect(items).toEqual([
      {
        id: "deck-001",
        type: "deck",
        brand: "Baker",
        name: "Hubba Cruiser",
        imageUrl: "https://cdn.example.com/deck.png",
        rarity: "rare",
        acquiredAt: new Date("2026-05-20T18:00:00Z"),
        provenanceReason: "Won the Hollenbeck bracket",
      },
    ]);
  });

  it("returns an empty array for an empty locker", async () => {
    nextSnapshot([]);
    await expect(fetchLockerItems(UID)).resolves.toEqual([]);
  });

  it("accepts catalogue values the client does not know about", async () => {
    nextSnapshot([itemDoc("mystery", { type: "hoverboard", rarity: "mythic" })]);

    const [item] = await fetchLockerItems(UID);

    expect(item.type).toBe("hoverboard");
    expect(item.rarity).toBe("mythic");
  });

  it("drops unknown server-side fields from the returned item", async () => {
    nextSnapshot([itemDoc("deck-001", { seasonId: 4, tradeable: true })]);

    const [item] = await fetchLockerItems(UID);

    expect(Object.keys(item).sort()).toEqual([
      "acquiredAt",
      "brand",
      "id",
      "imageUrl",
      "name",
      "provenanceReason",
      "rarity",
      "type",
    ]);
  });

  it("propagates transport failures instead of masking them as an empty locker", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" });
    mockGetDocs.mockRejectedValueOnce(denied);

    await expect(fetchLockerItems(UID)).rejects.toThrow(/insufficient permissions/);
  });
});

describe("fetchLockerItems — uid validation", () => {
  it("returns [] for an empty uid and never queries", async () => {
    await expect(fetchLockerItems("")).resolves.toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("returns [] for a non-string uid and never queries", async () => {
    await expect(fetchLockerItems(null as unknown as string)).resolves.toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("returns [] for a uid carrying a path separator and never queries", async () => {
    await expect(fetchLockerItems("a/b")).resolves.toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});

describe("fetchLockerItems — missing field fallbacks", () => {
  it("falls back to an empty brand when the field is absent or mistyped", async () => {
    nextSnapshot([itemDoc("no-brand", { brand: undefined }), itemDoc("bad-brand", { brand: 12 })]);
    const items = await fetchLockerItems(UID);
    expect(items.map((i) => i.brand)).toEqual(["", ""]);
  });

  it.each([
    { label: "absent", imageUrl: undefined },
    { label: "blank", imageUrl: "   " },
    { label: "not a string", imageUrl: { url: "x" } },
  ])("nulls an imageUrl that is $label", async ({ imageUrl }) => {
    nextSnapshot([itemDoc("art-less", { imageUrl })]);
    const [item] = await fetchLockerItems(UID);
    expect(item.imageUrl).toBeNull();
  });

  it("defaults rarity to common when the server has not set one", async () => {
    nextSnapshot([itemDoc("legacy", { rarity: undefined })]);
    const [item] = await fetchLockerItems(UID);
    expect(item.rarity).toBe("common");
  });

  it.each([
    { label: "provenance is absent", provenance: undefined },
    { label: "provenance is a primitive", provenance: "won it" },
    { label: "provenance.reason is missing", provenance: { grantedBy: "system" } },
    { label: "provenance.reason is not a string", provenance: { reason: 99 } },
  ])("nulls provenanceReason when $label", async ({ provenance }) => {
    nextSnapshot([itemDoc("unsourced", { provenance })]);
    const [item] = await fetchLockerItems(UID);
    expect(item.provenanceReason).toBeNull();
  });

  it.each([
    { label: "absent", acquiredAt: undefined },
    { label: "a primitive", acquiredAt: 1750000000000 },
    { label: "missing a callable toDate", acquiredAt: { toDate: null } },
    { label: "a toDate returning a non-Date", acquiredAt: { toDate: () => "yesterday" } },
    { label: "a toDate returning an invalid Date", acquiredAt: { toDate: () => new Date("nope") } },
  ])("nulls acquiredAt when the field is $label", async ({ acquiredAt }) => {
    nextSnapshot([itemDoc("undated", { acquiredAt })]);
    const [item] = await fetchLockerItems(UID);
    expect(item.acquiredAt).toBeNull();
  });

  it("converts a Timestamp acquiredAt into a Date", async () => {
    nextSnapshot([itemDoc("dated", { acquiredAt: ACQUIRED_JAN })]);
    const [item] = await fetchLockerItems(UID);
    expect(item.acquiredAt).toBeInstanceOf(Date);
    expect(item.acquiredAt?.toISOString()).toBe("2026-01-02T08:00:00.000Z");
  });
});

describe("fetchLockerItems — malformed docs", () => {
  it.each([
    { label: "name is missing", overrides: { name: undefined } },
    { label: "name is blank", overrides: { name: "  " } },
    { label: "name is not a string", overrides: { name: 5 } },
    { label: "type is missing", overrides: { type: undefined } },
    { label: "type is blank", overrides: { type: "" } },
  ])("skips an item whose $label", async ({ overrides }) => {
    nextSnapshot([itemDoc("unrenderable", overrides), itemDoc("keeper")]);

    const items = await fetchLockerItems(UID);

    expect(items.map((i) => i.id)).toEqual(["keeper"]);
  });

  it("skips a doc with no data at all", async () => {
    nextSnapshot([{ id: "ghost", data: () => null }, itemDoc("keeper")]);
    const items = await fetchLockerItems(UID);
    expect(items.map((i) => i.id)).toEqual(["keeper"]);
  });

  it("skips a doc whose data is a primitive", async () => {
    nextSnapshot([{ id: "weird", data: () => 42 }, itemDoc("keeper")]);
    const items = await fetchLockerItems(UID);
    expect(items.map((i) => i.id)).toEqual(["keeper"]);
  });

  it("skips docs with an unusable id", async () => {
    nextSnapshot([
      { id: 3 as unknown as string, data: () => ({ type: "deck", name: "numeric id" }) },
      { id: "", data: () => ({ type: "deck", name: "blank id" }) },
      itemDoc("keeper"),
    ]);
    const items = await fetchLockerItems(UID);
    expect(items.map((i) => i.id)).toEqual(["keeper"]);
  });

  it("swallows a throwing doc rather than failing the whole locker", async () => {
    nextSnapshot([
      {
        id: "explosive",
        data: () => {
          throw new Error("snapshot decode failed");
        },
      },
      itemDoc("keeper"),
    ]);

    const items = await fetchLockerItems(UID);

    expect(items.map((i) => i.id)).toEqual(["keeper"]);
  });
});

describe("fetchLockerItems — ordering", () => {
  it("orders by acquiredAt descending", async () => {
    nextSnapshot([
      itemDoc("january", { acquiredAt: ACQUIRED_JAN }),
      itemDoc("may", { acquiredAt: ACQUIRED_MAY }),
      itemDoc("ancient", { acquiredAt: new StubTimestamp(new Date("2025-11-11T00:00:00Z")) }),
    ]);

    const items = await fetchLockerItems(UID);

    expect(items.map((i) => i.id)).toEqual(["may", "january", "ancient"]);
  });

  it("sinks undated items to the bottom when listed first", async () => {
    nextSnapshot([itemDoc("undated", { acquiredAt: undefined }), itemDoc("dated")]);
    const items = await fetchLockerItems(UID);
    expect(items.map((i) => i.id)).toEqual(["dated", "undated"]);
  });

  it("sinks undated items to the bottom when listed last", async () => {
    nextSnapshot([itemDoc("dated"), itemDoc("undated", { acquiredAt: undefined })]);
    const items = await fetchLockerItems(UID);
    expect(items.map((i) => i.id)).toEqual(["dated", "undated"]);
  });
});

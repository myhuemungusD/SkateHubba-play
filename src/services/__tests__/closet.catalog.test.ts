import { describe, it, expect, vi, beforeEach } from "vitest";

type AnyMock = (...args: unknown[]) => unknown;

// fetchCatalogItem and fetchCatalog are pure reads: getDoc() / getDocs() + collection()
const mockGetDoc = vi.fn<AnyMock>();
const mockGetDocs = vi.fn<AnyMock>();
const mockCollection = vi.fn<AnyMock>((..._args) => (_args.slice(1) as string[]).join("/"));
const mockDoc = vi.fn<AnyMock>((...args) => args.slice(1).join("/"));
const mockQuery = vi.fn<AnyMock>((...args) => args);
const mockWhere = vi.fn<AnyMock>((...args) => args);

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
}));

vi.mock("../../firebase");

import { fetchCatalogItem, fetchCatalog, fetchShopItems } from "../closet.catalog";

const ITEM_DEF_ID = "limited-og-deck";

function toTimestamp(date: Date) {
  return {
    toDate: () => date,
  };
}

function catalogDoc(itemDefId: string, overrides: Record<string, unknown> = {}) {
  const defaults = {
    name: "OG Deck",
    type: "deck",
    slot: "deck",
    rarity: "limited",
    artUrl: "https://cdn.example.com/og-deck.png",
    layerUrls: { front: "https://cdn.example.com/og-deck-front.png", back: null },
    model3dUrl: null,
    edition: { kind: "limited", supply: 250, minted: 37, soldOut: false },
    source: "drop",
    priceBucks: null,
    dropId: "drop-2024-w42",
    licensed: { brand: "Hubba", licenseRef: null },
    releasedAt: toTimestamp(new Date("2024-10-01T00:00:00Z")),
    retiredAt: null,
  };

  const merged = { ...defaults, ...overrides };

  if (merged.releasedAt instanceof Date) {
    merged.releasedAt = toTimestamp(merged.releasedAt);
  }
  if (merged.retiredAt instanceof Date) {
    merged.retiredAt = toTimestamp(merged.retiredAt);
  }

  return {
    id: itemDefId,
    exists: () => true,
    data: () => merged,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchCatalogItem", () => {
  it("reads catalog/{itemDefId} and maps the full item shape", async () => {
    mockGetDoc.mockResolvedValueOnce(catalogDoc(ITEM_DEF_ID));

    const item = await fetchCatalogItem(ITEM_DEF_ID);

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "catalog", ITEM_DEF_ID);
    expect(item).not.toBeNull();
    expect(item?.id).toBe(ITEM_DEF_ID);
    expect(item?.name).toBe("OG Deck");
    expect(item?.rarity).toBe("limited");
    expect(item?.source).toBe("drop");
  });

  it("returns null for non-existent item", async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });

    const item = await fetchCatalogItem("missing-item");

    expect(item).toBeNull();
  });

  it("propagates transport failures gracefully (returns null)", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" });
    mockGetDoc.mockRejectedValueOnce(denied);

    const item = await fetchCatalogItem(ITEM_DEF_ID);

    expect(item).toBeNull();
  });

  it("handles malformed data gracefully (missing required fields)", async () => {
    mockGetDoc.mockResolvedValueOnce({
      id: ITEM_DEF_ID,
      exists: () => true,
      data: () => ({}),
    });

    const item = await fetchCatalogItem(ITEM_DEF_ID);

    expect(item).toEqual({
      id: ITEM_DEF_ID,
      name: "",
      type: "",
      slot: "accessory",
      rarity: "common",
      artUrl: "",
      layerUrls: { front: "", back: null },
      model3dUrl: null,
      edition: { kind: "open", supply: null, minted: 0, soldOut: false },
      source: "earn",
      priceBucks: null,
      dropId: null,
      licensed: { brand: null, licenseRef: null },
      releasedAt: null,
      retiredAt: null,
    });
  });
});

describe("fetchCatalog", () => {
  it("reads catalog collection and returns released, non-retired items", async () => {
    const now = Date.now();
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        catalogDoc("item-1", { name: "Deck 1", releasedAt: new Date(now - 86400 * 1000) }),
        catalogDoc("item-2", { name: "Deck 2", rarity: "rare", releasedAt: new Date(now - 172800 * 1000) }),
      ],
    });

    const items = await fetchCatalog();

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "catalog");
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Deck 1");
    expect(items[1].name).toBe("Deck 2");
  });

  it("filters by source when provided", async () => {
    const now = Date.now();
    mockGetDocs.mockResolvedValueOnce({
      docs: [catalogDoc("item-1", { source: "drop", name: "Drop Item", releasedAt: new Date(now - 86400 * 1000) })],
    });

    const items = await fetchCatalog("drop");

    expect(mockWhere).toHaveBeenCalledWith("source", "==", "drop");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Drop Item");
  });

  it("excludes unreleased items", async () => {
    const now = Date.now();
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        catalogDoc("released", { name: "Released", releasedAt: new Date(now - 86400 * 1000) }),
        catalogDoc("future", { name: "Future", releasedAt: new Date(now + 86400 * 1000) }),
      ],
    });

    const items = await fetchCatalog();

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("released");
  });

  it("excludes retired items", async () => {
    const now = Date.now();
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        catalogDoc("active", { name: "Active", releasedAt: new Date(now - 86400 * 1000), retiredAt: null }),
        catalogDoc("retired", {
          name: "Retired",
          releasedAt: new Date(now - 172800 * 1000),
          retiredAt: new Date(now - 86400 * 1000),
        }),
      ],
    });

    const items = await fetchCatalog();

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("active");
  });

  it("returns empty array for empty catalog", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const items = await fetchCatalog();

    expect(items).toEqual([]);
  });

  it("skips malformed docs (parseCatalogDoc returns null)", async () => {
    const now = Date.now();
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        catalogDoc("valid", { name: "Valid Item", releasedAt: new Date(now - 86400 * 1000) }),
        {
          id: "malformed",
          exists: () => true,
          data: () => null,
        },
      ],
    });

    const items = await fetchCatalog();

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("valid");
  });

  it("returns empty array on transport error", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" });
    mockGetDocs.mockRejectedValueOnce(denied);

    const items = await fetchCatalog();

    expect(items).toEqual([]);
  });
});

describe("fetchShopItems", () => {
  it("reads catalog with source=shop filter and excludes sold-out items", async () => {
    const now = Date.now();
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        catalogDoc("shop-1", {
          source: "shop",
          priceBucks: 500,
          name: "Shop Deck",
          releasedAt: new Date(now - 86400 * 1000),
          edition: { kind: "open", supply: null, minted: 0, soldOut: false },
        }),
        catalogDoc("shop-2", {
          source: "shop",
          priceBucks: 1000,
          name: "Sold Out Deck",
          rarity: "limited",
          releasedAt: new Date(now - 86400 * 1000),
          edition: { kind: "limited", supply: 100, minted: 100, soldOut: true },
        }),
        catalogDoc("shop-3", {
          source: "shop",
          priceBucks: 750,
          name: "Premium Deck",
          rarity: "rare",
          releasedAt: new Date(now - 86400 * 1000),
          edition: { kind: "open", supply: null, minted: 0, soldOut: false },
        }),
      ],
    });

    const items = await fetchShopItems();

    expect(mockWhere).toHaveBeenCalledWith("source", "==", "shop");
    expect(items).toHaveLength(2);
    expect(items[0].priceBucks).toBe(500);
    expect(items[1].priceBucks).toBe(750);
  });

  it("returns empty array when no shop items exist", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const items = await fetchShopItems();

    expect(items).toEqual([]);
  });
});

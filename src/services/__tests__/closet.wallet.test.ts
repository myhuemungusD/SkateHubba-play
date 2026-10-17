import { describe, it, expect, vi, beforeEach } from "vitest";

type AnyMock = (...args: unknown[]) => unknown;

const mockGetDoc = vi.fn<AnyMock>();
const mockGetDocs = vi.fn<AnyMock>();
const mockCollection = vi.fn<AnyMock>((..._args) => (_args.slice(1) as string[]).join("/"));
const mockDoc = vi.fn<AnyMock>((...args) => args.slice(1).join("/"));

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (...args: unknown[]) => args,
}));

vi.mock("../../firebase");

import { fetchWalletBalance, fetchLedgerHistory } from "../closet.wallet";

const UID = "wallet-owner";

class StubTimestamp {
  constructor(private readonly when: Date) {}
  toDate(): Date {
    return this.when;
  }
}

const TIMESTAMP_NOW = new StubTimestamp(new Date("2026-10-17T12:00:00Z"));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchWalletBalance", () => {
  it("reads wallet/{uid}/main and returns balance", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ balance: 1500, earnedBal: 1000, boughtBal: 500 }),
    });

    const wallet = await fetchWalletBalance(UID);

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", UID, "wallet", "main");
    expect(wallet).toEqual({ balance: 1500, earnedBal: 1000, boughtBal: 500 });
  });

  it("returns zero balance for non-existent wallet", async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => null });

    const wallet = await fetchWalletBalance(UID);

    expect(wallet).toEqual({ balance: 0, earnedBal: 0, boughtBal: 0 });
  });

  it("handles malformed data gracefully", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ balance: "not-a-number" }),
    });

    const wallet = await fetchWalletBalance(UID);

    expect(wallet).toEqual({ balance: 0, earnedBal: 0, boughtBal: 0 });
  });

  it("returns zero balance on transport error", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" });
    mockGetDoc.mockRejectedValueOnce(denied);

    const wallet = await fetchWalletBalance(UID);

    expect(wallet).toEqual({ balance: 0, earnedBal: 0, boughtBal: 0 });
  });
});

describe("fetchLedgerHistory", () => {
  it("reads ledger/{uid}/entries and returns sorted entries", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "entry1",
          data: () => ({
            amount: 35,
            reason: "game_complete",
            createdAt: TIMESTAMP_NOW,
            source: "earned",
            ref: "game123",
          }),
        },
        {
          id: "entry2",
          data: () => ({
            amount: 100,
            reason: "shop_purchase",
            createdAt: TIMESTAMP_NOW,
            source: "spent",
            ref: "item456",
          }),
        },
      ],
    });

    const entries = await fetchLedgerHistory(UID, 10);

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "users", UID, "ledger");
    expect(entries).toHaveLength(2);
    expect(entries[0].amount).toBe(35);
    expect(entries[0].reason).toBe("game_complete");
    expect(entries[0].source).toBe("earned");
  });

  it("returns empty array for non-existent ledger", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    const entries = await fetchLedgerHistory(UID, 10);

    expect(entries).toEqual([]);
  });

  it("skips malformed entries (missing createdAt)", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "valid",
          data: () => ({ amount: 35, reason: "game_complete", createdAt: TIMESTAMP_NOW, source: "earned", ref: null }),
        },
        { id: "malformed", data: () => ({ amount: 50, reason: "missing_date" }) },
      ],
    });

    const entries = await fetchLedgerHistory(UID, 10);

    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(35);
  });

  it("returns empty array on transport error", async () => {
    const denied = Object.assign(new Error("Missing or insufficient permissions"), { code: "permission-denied" });
    mockGetDocs.mockRejectedValueOnce(denied);

    const entries = await fetchLedgerHistory(UID, 10);

    expect(entries).toEqual([]);
  });
});

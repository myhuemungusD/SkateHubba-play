import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  record: vi.fn(),
  warn: vi.fn(),
  toDisputeDoc: vi.fn(),
  uid: { v: "a1" as string | null },
}));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  where: (...a: unknown[]) => ({ where: a }),
  limit: (n: number) => ({ limit: n }),
  query: (...a: unknown[]) => a,
  serverTimestamp: () => "TS",
  getDocs: h.getDocs,
  updateDoc: h.updateDoc,
}));
vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
  requireAuth: () => ({ currentUser: h.uid.v ? { uid: h.uid.v } : null }),
}));
vi.mock("../disputes.mappers", () => ({ disputesRef: () => "disputes", toDisputeDoc: h.toDisputeDoc }));
vi.mock("../admin.audit", () => ({ recordAdminAction: h.record }));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));

import { listDisputeQueue, ruleDispute } from "../admin.disputes";

beforeEach(() => {
  vi.clearAllMocks();
  h.uid.v = "a1";
});

describe("listDisputeQueue", () => {
  it("maps, skips malformed docs, reads rulings and sorts newest first", async () => {
    const at = (ms: number) => ({ toMillis: () => ms });
    h.getDocs.mockResolvedValue({
      docs: [
        { id: "a", data: () => ({ adminRuling: "land" }) },
        { id: "b", data: () => ({ adminRuling: "bail" }) },
        { id: "c", data: () => ({ adminRuling: "nope" }) },
        { id: "bad", data: () => ({}) },
        { id: "bad2", data: () => ({}) },
      ],
    });
    h.toDisputeDoc.mockImplementation((d: { id: string }) => {
      if (d.id === "bad") throw new Error("malformed");
      if (d.id === "bad2") throw "weird";
      return { id: d.id, createdAt: d.id === "a" ? at(1) : d.id === "b" ? at(5) : null };
    });
    const rows = await listDisputeQueue();
    expect(rows.map((r) => [r.id, r.adminRuling])).toEqual([
      ["b", "bail"],
      ["a", "land"],
      ["c", null],
    ]);
    expect(h.warn).toHaveBeenCalledWith("dispute_queue_malformed", { id: "bad", error: "malformed" });
    expect(h.warn).toHaveBeenCalledWith("dispute_queue_malformed", { id: "bad2", error: "weird" });
  });
  it("sorts two undated disputes stably", async () => {
    h.getDocs.mockResolvedValue({
      docs: [
        { id: "x", data: () => ({}) },
        { id: "y", data: () => ({}) },
      ],
    });
    h.toDisputeDoc.mockImplementation((d: { id: string }) => ({ id: d.id, createdAt: null }));
    expect((await listDisputeQueue()).map((r) => r.id)).toEqual(["x", "y"]);
  });
});

describe("ruleDispute", () => {
  it("stamps the ruling and records it", async () => {
    h.updateDoc.mockResolvedValue(undefined);
    await ruleDispute("d1", "bail");
    expect(h.updateDoc).toHaveBeenCalledWith("disputes/d1", {
      adminRuling: "bail",
      adminRuledBy: "a1",
      adminRuledAt: "TS",
    });
    expect(h.record).toHaveBeenCalledWith("rule_dispute", "d1", "bail");
  });
  it("rejects without auth or with a bad ruling", async () => {
    await expect(ruleDispute("d1", "x" as "land")).rejects.toThrow("Invalid ruling.");
    h.uid.v = null;
    await expect(ruleDispute("d1", "land")).rejects.toThrow("Sign in again");
    expect(h.updateDoc).not.toHaveBeenCalled();
  });
});

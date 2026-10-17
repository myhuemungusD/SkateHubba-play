import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { adminClosetDb } from "./store.js";

function snap(id: string, data: Record<string, unknown> | undefined) {
  return { id, exists: data !== undefined, data: () => data };
}

function fakeFirestore() {
  const calls: string[] = [];
  const docRef = (path: string): Record<string, unknown> => ({
    path,
    get: async () => snap(path.split("/").pop()!, path.endsWith("missing") ? undefined : { path }),
    collection: (c: string) => colRef(`${path}/${c}`),
  });
  const colRef = (path: string): Record<string, unknown> => {
    const query: Record<string, unknown> = {
      path,
      where: (f: string, op: string, v: unknown) => (calls.push(`where:${f}${op}${String(v)}`), query),
      limit: (n: number) => (calls.push(`limit:${n}`), query),
      get: async () => ({ docs: [snap("a", { n: 1 })] }),
      doc: (id?: string) => (id ? docRef(`${path}/${id}`) : { id: "auto1" }),
    };
    return query;
  };
  const tx = {
    get: vi.fn(async (ref: { path?: string; get: () => Promise<unknown> }) => ref.get()),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const db = {
    collection: (c: string) => colRef(c),
    runTransaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { db: db as unknown as Firestore, tx, calls };
}

describe("adminClosetDb", () => {
  it("reads docs and queries outside a transaction", async () => {
    const { db, calls } = fakeFirestore();
    const closet = adminClosetDb(db);
    expect(await closet.get("users/u/wallet/main")).toEqual({ id: "main", data: { path: "users/u/wallet/main" } });
    expect(await closet.get("users/missing")).toEqual({ id: "missing", data: undefined });
    const rows = await closet.query({
      collection: "drops",
      filters: [{ field: "kind", op: "==", value: "draw" }],
      limit: 2,
    });
    expect(rows).toEqual([{ id: "a", data: { n: 1 } }]);
    expect(calls).toEqual(["where:kind==draw", "limit:2"]);
    expect(closet.newId("trades")).toBe("auto1");
  });

  it("wraps a transaction with get, query, set, update and delete", async () => {
    const { db, tx } = fakeFirestore();
    const closet = adminClosetDb(db);
    const out = await closet.runTransaction(async (t) => {
      const a = await t.get("catalog/x");
      const b = await t.get("catalog/missing");
      const q = await t.query({ collection: "trades", filters: [] });
      t.set("catalog/x", { a: 1 });
      t.set("catalog/y", { a: 1 }, true);
      t.update("catalog/x", { b: 2 });
      t.delete("users/u/locker/c");
      return [a.data, b.data, q.length];
    });
    expect(out).toEqual([{ path: "catalog/x" }, undefined, 1]);
    expect(tx.set.mock.calls.map((c) => c[2])).toEqual([{ merge: false }, { merge: true }]);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect((tx.delete.mock.calls[0]?.[0] as { path: string }).path).toBe("users/u/locker/c");
  });
});

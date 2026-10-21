import { describe, expect, it, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { arrayRemove: (...v: string[]) => ({ rm: v }), serverTimestamp: () => "TS", delete: () => "DEL" },
}));

import { adminDrainDeps, readQueue, toQueuedDoc } from "./store.js";

function fakeDb() {
  const sets: { path: string; data: unknown }[] = [];
  const query = { orderBy: vi.fn(), limit: vi.fn(), get: vi.fn() };
  const docRef = (path: string): Record<string, unknown> => ({
    set: vi.fn(async (data: unknown) => {
      sets.push({ path, data });
    }),
    get: vi.fn(async () => ({ data: () => (path === "pushTargets/u1" ? { tokens: ["t"] } : undefined) })),
    collection: (c: string) => ({ doc: (id: string) => docRef(`${path}/${c}/${id}`) }),
  });
  const db = {
    collection: (c: string) => ({ doc: (id: string) => docRef(`${c}/${id}`), orderBy: query.orderBy }),
  };
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return { db, sets, query };
}

describe("push store", () => {
  it("prunes both token lists and sends via messaging", async () => {
    const { db, sets } = fakeDb();
    const messaging = { sendEachForMulticast: vi.fn(async () => ({ failureCount: 0, responses: [] })) };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = adminDrainDeps(db as never, messaging as never, 5);
    expect(d.nowMs).toBe(5);
    await d.prune("u1", ["t"]);
    expect(sets).toEqual([
      { path: "pushTargets/u1", data: { tokens: { rm: ["t"] }, platforms: { t: "DEL" }, updatedAt: "TS" } },
      { path: "users/u1/private/profile", data: { fcmTokens: { rm: ["t"] } } },
    ]);
    expect(await d.pushTarget("u1")).toEqual({ tokens: ["t"] });
    expect(await d.pushTarget("nobody")).toBeUndefined();
    const msg = { tokens: ["t"], notification: { title: "a", body: "b" }, data: {} };
    await d.send(msg);
    expect(messaging.sendEachForMulticast).toHaveBeenCalledWith(msg);
    d.warn("e", { a: 1 });
    expect(warnSpy).toHaveBeenCalledWith(JSON.stringify({ event: "e", a: 1 }));
    warnSpy.mockRestore();
  });

  it("maps snapshots and reads the queue oldest first", async () => {
    const { db, query } = fakeDb();
    const del = vi.fn(async () => {});
    query.get.mockResolvedValue({
      docs: [
        { id: "a", data: () => ({ createdAt: { toMillis: () => 9 } }), ref: { delete: del } },
        { id: "b", data: () => undefined, ref: { delete: del } },
      ],
    });
    const q = await readQueue(db as never);
    expect(query.orderBy).toHaveBeenCalledWith("createdAt", "asc");
    expect(query.limit).toHaveBeenCalledWith(200);
    expect(q.map((x) => [x.id, x.createdAtMs])).toEqual([
      ["a", 9],
      ["b", null],
    ]);
    await q[1].delete();
    expect(del).toHaveBeenCalled();
    expect(toQueuedDoc({ id: "c", data: () => ({}), ref: { delete: del } }).createdAtMs).toBeNull();
  });
});

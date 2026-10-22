import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { adminRetentionDeps } from "./store.js";

type Bucket = Parameters<typeof adminRetentionDeps>[1];

function fakeDb(collections: Record<string, { id: string; data: unknown }[]>, games: string[]) {
  const makeQuery = (name: string, after: number, limit: number) => ({
    orderBy: () => makeQuery(name, after, limit),
    limit: (n: number) => makeQuery(name, after, n),
    startAfter: (doc: { index: number }) => makeQuery(name, doc.index + 1, limit),
    get: async () => {
      const docs = (collections[name] ?? []).slice(after, after + limit).map((d, i) => ({
        index: after + i,
        data: () => d.data,
      }));
      return { docs, size: docs.length };
    },
  });
  const getAll = vi.fn(async (...refs: { id: string }[]) =>
    refs.map((r) => ({ id: r.id, exists: games.includes(r.id) })),
  );
  const db = {
    collection: (name: string) => ({
      ...makeQuery(name, 0, Infinity),
      doc: (id: string) => ({ id }),
    }),
    getAll,
  };
  return { db: db as unknown as Firestore, getAll };
}

describe("adminRetentionDeps", () => {
  it("lists games/ objects with their creation time, falling back to now", async () => {
    const getFiles = vi.fn(async () => [
      [
        { name: "games/a/turn-1/set-u.mp4", metadata: { timeCreated: "2026-01-01T00:00:00Z" } },
        { name: "games/a/turn-2/set-u.mp4", metadata: {} },
      ],
    ]);
    const bucket = { getFiles, file: vi.fn() } as unknown as Bucket;
    vi.spyOn(Date, "now").mockReturnValue(123);
    const objects = await adminRetentionDeps(fakeDb({}, []).db, bucket).listGameObjects();
    vi.restoreAllMocks();
    expect(getFiles).toHaveBeenCalledWith({ prefix: "games/", autoPaginate: true });
    expect(objects).toEqual([
      { name: "games/a/turn-1/set-u.mp4", createdMs: Date.UTC(2026, 0, 1) },
      { name: "games/a/turn-2/set-u.mp4", createdMs: 123 },
    ]);
  });

  it("pages through a collection 500 docs at a time", async () => {
    const docs = Array.from({ length: 1001 }, (_, i) => ({ id: `d${i}`, data: { i } }));
    const { db } = fakeDb({ clips: docs }, []);
    const data = await adminRetentionDeps(db, {} as Bucket).readCollection("clips");
    expect(data).toHaveLength(1001);
    expect(data[1000]).toEqual({ i: 1000 });
  });

  it("returns an empty list for an empty collection", async () => {
    const { db } = fakeDb({}, []);
    expect(await adminRetentionDeps(db, {} as Bucket).readCollection("reports")).toEqual([]);
  });

  it("checks game existence in batches and skips the call when there are no ids", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `g${i}`);
    const { db, getAll } = fakeDb({}, ["g0", "g500"]);
    const deps = adminRetentionDeps(db, {} as Bucket);
    expect([...(await deps.existingGameIds(ids))].sort()).toEqual(["g0", "g500"]);
    expect(getAll).toHaveBeenCalledTimes(2);
    expect((await deps.existingGameIds([])).size).toBe(0);
    expect(getAll).toHaveBeenCalledTimes(2);
  });

  it("deletes an object, ignoring one already gone", async () => {
    const del = vi.fn(async () => undefined);
    const file = vi.fn(() => ({ delete: del }));
    await adminRetentionDeps(fakeDb({}, []).db, { file } as unknown as Bucket).deleteObject("games/a/x.mp4");
    expect(file).toHaveBeenCalledWith("games/a/x.mp4");
    expect(del).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});

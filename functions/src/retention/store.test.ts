import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { adminRetentionDeps } from "./store.js";

type Bucket = Parameters<typeof adminRetentionDeps>[1];

function fakeDb(collections: Record<string, unknown[]>, existing: Record<string, Record<string, unknown>>) {
  const selects: string[][] = [];
  const makeQuery = (name: string, after: number, limit: number) => ({
    select: (...fields: string[]) => {
      selects.push(fields);
      return makeQuery(name, after, limit);
    },
    orderBy: () => makeQuery(name, after, limit),
    limit: (n: number) => makeQuery(name, after, n),
    startAfter: (doc: { index: number }) => makeQuery(name, doc.index + 1, limit),
    get: async () => {
      const docs = (collections[name] ?? []).slice(after, after + limit).map((data, i) => ({
        index: after + i,
        data: () => data,
      }));
      return { docs, size: docs.length };
    },
  });
  const getAll = vi.fn(async (...args: unknown[]) =>
    (args.slice(0, -1) as { id: string; path: string }[]).map((r) => ({
      id: r.id,
      exists: r.path in existing,
      data: () => existing[r.path],
    })),
  );
  const db = {
    collection: (name: string) => ({
      ...makeQuery(name, 0, Infinity),
      doc: (id: string) => ({ id, path: `${name}/${id}` }),
    }),
    getAll,
  };
  return { db: db as unknown as Firestore, getAll, selects };
}

describe("adminRetentionDeps", () => {
  it("pages games/ objects with their creation time, falling back to now", async () => {
    const getFiles = vi
      .fn()
      .mockResolvedValueOnce([
        [{ name: "games/a/turn-1/set-u.mp4", metadata: { timeCreated: "2026-01-01T00:00:00Z" } }],
        { pageToken: "p2" },
      ])
      .mockResolvedValueOnce([[{ name: "games/a/turn-2/set-u.mp4", metadata: {} }], null]);
    vi.spyOn(Date, "now").mockReturnValue(123);
    const objects = await adminRetentionDeps(fakeDb({}, {}).db, { getFiles } as unknown as Bucket).listGameObjects();
    vi.restoreAllMocks();
    expect(getFiles).toHaveBeenNthCalledWith(1, {
      prefix: "games/",
      autoPaginate: false,
      maxResults: 1000,
      pageToken: undefined,
    });
    expect(getFiles).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageToken: "p2" }));
    expect(objects).toEqual([
      { name: "games/a/turn-1/set-u.mp4", createdMs: Date.UTC(2026, 0, 1) },
      { name: "games/a/turn-2/set-u.mp4", createdMs: 123 },
    ]);
  });

  it("visits a collection 500 docs at a time, selecting only the named fields", async () => {
    const docs = Array.from({ length: 1001 }, (_, i) => ({ i }));
    const { db, selects } = fakeDb({ clips: docs }, {});
    const seen: unknown[] = [];
    await adminRetentionDeps(db, {} as Bucket).forEachDoc("clips", ["videoUrl"], (d) => seen.push(d));
    expect(seen).toHaveLength(1001);
    expect(seen[1000]).toEqual({ i: 1000 });
    expect(selects).toEqual([["videoUrl"]]);
  });

  it("reads existing games and clips in batches with a field mask", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `g${i}`);
    const { db, getAll } = fakeDb({}, { "games/g0": { status: "active" }, "games/g500": {}, "clips/c1": {} });
    const deps = adminRetentionDeps(db, {} as Bucket);
    const games = await deps.readGames(ids);
    expect([...games.keys()].sort()).toEqual(["g0", "g500"]);
    expect(games.get("g0")).toEqual({ status: "active" });
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(getAll.mock.calls[0]?.at(-1)).toEqual({ fieldMask: ["status", "currentTrickVideoUrl", "matchVideoUrl"] });
    expect([...(await deps.existingClipIds(["c1", "c2"]))]).toEqual(["c1"]);
    expect((await deps.readGames([])).size).toBe(0);
    expect(getAll).toHaveBeenCalledTimes(3);
  });

  it("deletes an object, ignoring one already gone", async () => {
    const del = vi.fn(async () => undefined);
    const file = vi.fn(() => ({ delete: del }));
    await adminRetentionDeps(fakeDb({}, {}).db, { file } as unknown as Bucket).deleteObject("games/a/x.mp4");
    expect(file).toHaveBeenCalledWith("games/a/x.mp4");
    expect(del).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});

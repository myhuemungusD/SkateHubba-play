import { describe, expect, it, vi } from "vitest";
import {
  ORPHAN_GRACE_MS,
  REFERENCE_COLLECTIONS,
  RETENTION_DAYS,
  collectGamePaths,
  gameIdOf,
  runGameVideoRetention,
  type RetentionDeps,
  type StoredObject,
} from "./gameVideos.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 22);
const url = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=t`;

function deps(over: {
  objects: StoredObject[];
  docs?: Record<string, unknown[]>;
  liveGames?: string[];
  deleteFails?: string[];
}): RetentionDeps & { deleted: string[]; read: string[] } {
  const deleted: string[] = [];
  const read: string[] = [];
  return {
    deleted,
    read,
    listGameObjects: async () => over.objects,
    readCollection: async (name) => {
      read.push(name);
      return over.docs?.[name] ?? [];
    },
    existingGameIds: async (ids) => new Set(ids.filter((id) => (over.liveGames ?? []).includes(id))),
    deleteObject: async (name) => {
      if (over.deleteFails?.includes(name)) throw new Error(`boom ${name}`);
      deleted.push(name);
    },
  };
}

const old = (name: string): StoredObject => ({ name, createdMs: NOW - (RETENTION_DAYS + 1) * DAY });
const fresh = (name: string, ageMs = DAY): StoredObject => ({ name, createdMs: NOW - ageMs });

describe("collectGamePaths", () => {
  it("finds download URLs, gs:// URLs and raw paths at any depth", () => {
    const out = new Set<string>();
    collectGamePaths(
      {
        videoUrl: url("games/g1/turn-1/set-u1.mp4"),
        nested: { list: [url("games/g2/turn-2/match-u2.webm"), "gs://bucket/games/g3/turn-1/set-u3.mp4"] },
        storagePath: "games/g4/turn-5/set-u4.mp4",
        other: url("userClips/u1/x.mp4"),
        n: 3,
        nil: null,
        flag: true,
      },
      out,
    );
    expect([...out].sort()).toEqual([
      "games/g1/turn-1/set-u1.mp4",
      "games/g2/turn-2/match-u2.webm",
      "games/g3/turn-1/set-u3.mp4",
      "games/g4/turn-5/set-u4.mp4",
    ]);
  });

  it("ignores a malformed escape and non-game gs:// paths", () => {
    const out = new Set<string>();
    collectGamePaths(["https://x/o/games%2F%E0%A4%A?alt=media", "gs://bucket/userClips/a.mp4"], out);
    expect(out.size).toBe(0);
  });
});

describe("gameIdOf", () => {
  it("returns the game id only for objects inside a game folder", () => {
    expect(gameIdOf("games/abc/turn-1/set-u.mp4")).toBe("abc");
    expect(gameIdOf("games/abc/")).toBeNull();
    expect(gameIdOf("userClips/abc/x.mp4")).toBeNull();
  });
});

describe("runGameVideoRetention", () => {
  const clipPath = "games/g1/turn-1/set-u1.mp4";
  const disputePath = "games/g1/turn-2/match-u2.mp4";
  const expiredPath = "games/g1/turn-3/set-u1.mp4";
  const youngPath = "games/g1/turn-4/set-u1.mp4";
  const orphanPath = "games/gone/turn-1/set-u9.mp4";
  const youngOrphan = "games/gone/turn-2/set-u9.mp4";
  const referencedOrphan = "games/gone/turn-3/set-u9.mp4";
  const stray = "games/README";

  const world = {
    objects: [
      old(clipPath),
      old(disputePath),
      old(expiredPath),
      fresh(youngPath),
      fresh(orphanPath, 2 * DAY),
      fresh(youngOrphan, ORPHAN_GRACE_MS - 1000),
      fresh(referencedOrphan, 2 * DAY),
      old(stray),
    ],
    docs: {
      clips: [{ videoUrl: url(clipPath) }, { videoUrl: url(referencedOrphan) }],
      disputes: [{ matchVideoUrl: url(disputePath) }],
    },
    liveGames: ["g1"],
  };

  it("reads every reference collection", async () => {
    const d = deps(world);
    await runGameVideoRetention(d, { enabled: false, nowMs: NOW });
    expect(d.read).toEqual([...REFERENCE_COLLECTIONS]);
  });

  it("dry run counts what it would delete and deletes nothing", async () => {
    const d = deps(world);
    const summary = await runGameVideoRetention(d, { enabled: false, nowMs: NOW });
    expect(summary).toEqual({
      dryRun: true,
      scanned: 8,
      referenced: 3,
      expired: 1,
      orphaned: 1,
      deleted: 0,
      failed: 0,
    });
    expect(d.deleted).toEqual([]);
  });

  it("when enabled, deletes only unreferenced expired videos and settled orphans", async () => {
    const d = deps(world);
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(d.deleted).toEqual([expiredPath, orphanPath]);
    expect(summary).toMatchObject({ dryRun: false, deleted: 2, failed: 0 });
  });

  it("counts a failed delete and keeps going", async () => {
    const d = deps({ ...world, deleteFails: [expiredPath] });
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(d.deleted).toEqual([orphanPath]);
    expect(summary).toMatchObject({ deleted: 1, failed: 1 });
  });

  it("keeps a video exactly at the retention age", async () => {
    const d = deps({ objects: [fresh(expiredPath, RETENTION_DAYS * DAY)], liveGames: ["g1"] });
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(summary.expired).toBe(0);
    expect(d.deleted).toEqual([]);
  });

  it("asks for each game id once", async () => {
    const existing = vi.fn(async () => new Set<string>(["g1"]));
    const d = { ...deps(world), existingGameIds: existing };
    await runGameVideoRetention(d, { enabled: false, nowMs: NOW });
    expect(existing).toHaveBeenCalledWith(["g1", "gone"]);
  });
});

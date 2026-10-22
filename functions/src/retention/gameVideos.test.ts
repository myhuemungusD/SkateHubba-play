import { describe, expect, it, vi } from "vitest";
import {
  MAX_DELETES_PER_RUN,
  ORPHAN_GRACE_MS,
  RETENTION_DAYS,
  clipIdOf,
  gameIdOf,
  runAndLogGameVideoRetention,
  runGameVideoRetention,
  type GameDoc,
  type RetentionDeps,
  type StoredObject,
} from "./gameVideos.js";
import { REFERENCE_SOURCES } from "./references.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 22);
const url = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=t`;

function deps(over: {
  objects: StoredObject[];
  docs?: Record<string, Record<string, unknown>[]>;
  games?: Record<string, GameDoc>;
  newClips?: string[];
  deleteFails?: Record<string, unknown>;
}): RetentionDeps & { deleted: string[]; read: string[] } {
  const deleted: string[] = [];
  const read: string[] = [];
  return {
    deleted,
    read,
    listGameObjects: async () => over.objects,
    forEachDoc: async (name, _fields, visit) => {
      read.push(name);
      for (const doc of over.docs?.[name] ?? []) visit(doc);
    },
    readGames: async (ids) =>
      new Map(ids.filter((id) => over.games && id in over.games).map((id) => [id, over.games?.[id] as GameDoc])),
    existingClipIds: async (ids) => new Set(ids.filter((id) => over.newClips?.includes(id))),
    deleteObject: async (name) => {
      if (over.deleteFails && name in over.deleteFails) throw over.deleteFails[name];
      deleted.push(name);
    },
  };
}

const old = (name: string, extraDays = 1): StoredObject => ({
  name,
  createdMs: NOW - (RETENTION_DAYS + extraDays) * DAY,
});
const fresh = (name: string, ageMs = DAY): StoredObject => ({ name, createdMs: NOW - ageMs });

describe("path helpers", () => {
  it("gameIdOf returns the game id only for objects inside a game folder", () => {
    expect(gameIdOf("games/abc/turn-1/set-u.mp4")).toBe("abc");
    expect(gameIdOf("games/abc/")).toBeNull();
    expect(gameIdOf("userClips/abc/x.mp4")).toBeNull();
  });

  it("clipIdOf maps a turn video to its feed clip id", () => {
    expect(clipIdOf("games/abc/turn-3/match-u1.webm")).toBe("abc_3_match");
    expect(clipIdOf("games/abc/turn-3/thumb.jpg")).toBeNull();
  });
});

describe("runGameVideoRetention", () => {
  const clipPath = "games/g1/turn-1/set-u1.mp4";
  const expiredPath = "games/g1/turn-3/set-u1.mp4";
  const labelOptIn = "games/g1/turn-5/set-u1.mp4";
  const labelExcluded = "games/g1/turn-5/match-u2.mp4";
  const youngPath = "games/g1/turn-4/set-u1.mp4";
  const reportedGame = "games/rep/turn-1/set-u3.mp4";
  const disputedGame = "games/dis/turn-1/match-u3.mp4";
  const judgedGame = "games/mod/turn-2/set-u3.mp4";
  const activeTurn = "games/live/turn-9/set-u4.mp4";
  const activeOldTurn = "games/live/turn-1/set-u4.mp4";
  const orphanPath = "games/gone/turn-1/set-u9.mp4";
  const youngOrphan = "games/gone/turn-2/set-u9.mp4";
  const referencedOrphan = "games/gone/turn-3/set-u9.mp4";
  const stray = "games/README";

  const world = {
    objects: [
      old(clipPath),
      old(expiredPath),
      old(labelOptIn),
      old(labelExcluded),
      fresh(youngPath),
      old(reportedGame),
      old(disputedGame),
      old(judgedGame),
      old(activeTurn),
      old(activeOldTurn),
      fresh(orphanPath, 2 * DAY),
      fresh(youngOrphan, ORPHAN_GRACE_MS - 1000),
      fresh(referencedOrphan, 2 * DAY),
      old(stray),
    ],
    docs: {
      clips: [{ videoUrl: url(clipPath) }, { videoUrl: url(referencedOrphan) }],
      disputes: [{ gameId: "dis" }],
      reports: [{ gameId: "rep", clipId: "rep_1_set" }],
      moderationStatements: [{ contentRef: "mod_2_set" }, { contentRef: "account" }],
      trainingLabels: [
        { clipPath: labelOptIn, excluded: false, consent: { optedIn: true } },
        { clipPath: labelExcluded, excluded: true, consent: { optedIn: false } },
      ],
    },
    games: {
      g1: { status: "complete" },
      rep: { status: "complete" },
      dis: { status: "complete" },
      mod: { status: "complete" },
      live: { status: "active", currentTrickVideoUrl: url(activeTurn), matchVideoUrl: null },
    } as Record<string, GameDoc>,
  };

  it("reads every reference source", async () => {
    const d = deps(world);
    await runGameVideoRetention(d, { enabled: false, nowMs: NOW });
    expect(d.read).toEqual(REFERENCE_SOURCES.map((s) => s.collection));
  });

  it("dry run counts what it would delete and deletes nothing", async () => {
    const d = deps(world);
    const summary = await runGameVideoRetention(d, { enabled: false, nowMs: NOW });
    expect(summary).toEqual({
      dryRun: true,
      scanned: 13,
      kept: 7,
      expired: 3,
      orphaned: 1,
      deferred: 0,
      deleted: 0,
      failed: 0,
      failedCodes: {},
    });
    expect(d.deleted).toEqual([]);
  });

  it("when enabled, deletes only unpinned expired videos and settled orphans", async () => {
    const d = deps(world);
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(d.deleted.sort()).toEqual([activeOldTurn, expiredPath, labelExcluded, orphanPath].sort());
    expect(summary).toMatchObject({ dryRun: false, deleted: 4, failed: 0 });
  });

  it("keeps a candidate whose feed clip appeared after the references were read", async () => {
    const d = deps({ ...world, newClips: ["g1_3_set"] });
    await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(d.deleted).not.toContain(expiredPath);
    expect(d.deleted).toHaveLength(3);
  });

  it("counts failed deletes by safe code and keeps going", async () => {
    const forbidden = Object.assign(new Error(`no access to ${expiredPath}`), { code: 403 });
    const d = deps({ ...world, deleteFails: { [expiredPath]: forbidden, [orphanPath]: "weird" } });
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(d.deleted).toHaveLength(2);
    expect(summary).toMatchObject({ deleted: 2, failed: 2, failedCodes: { "code-403": 1, string: 1 } });
    expect(JSON.stringify(summary)).not.toContain("u1");
  });

  it("keeps a video exactly at the retention age", async () => {
    const d = deps({ objects: [fresh(expiredPath, RETENTION_DAYS * DAY)], games: { g1: {} } });
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(summary.expired).toBe(0);
    expect(d.deleted).toEqual([]);
  });

  it("aborts without deleting when objects exist but no game doc does", async () => {
    const d = deps({ objects: [old(expiredPath)], games: {} });
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(summary).toMatchObject({ aborted: "no_live_games", deleted: 0, expired: 0 });
    expect(d.deleted).toEqual([]);
  });

  it("does nothing on an empty bucket", async () => {
    const summary = await runGameVideoRetention(deps({ objects: [] }), { enabled: true, nowMs: NOW });
    expect(summary).toMatchObject({ scanned: 0, deleted: 0 });
    expect(summary.aborted).toBeUndefined();
  });

  it("deletes at most MAX_DELETES_PER_RUN, oldest first, and defers the rest", async () => {
    const objects = Array.from({ length: MAX_DELETES_PER_RUN + 3 }, (_, i) =>
      old(`games/g1/turn-${i}/set-u.mp4`, i + 1),
    );
    const d = deps({ objects, games: { g1: {} } });
    const summary = await runGameVideoRetention(d, { enabled: true, nowMs: NOW });
    expect(summary).toMatchObject({ expired: MAX_DELETES_PER_RUN + 3, deferred: 3, deleted: MAX_DELETES_PER_RUN });
    expect(d.deleted).toContain(`games/g1/turn-${MAX_DELETES_PER_RUN + 2}/set-u.mp4`);
    expect(d.deleted).not.toContain("games/g1/turn-0/set-u.mp4");
  });

  it("asks for each game id once", async () => {
    const d = deps(world);
    const readGames = vi.fn(d.readGames);
    await runGameVideoRetention({ ...d, readGames }, { enabled: false, nowMs: NOW });
    expect(readGames).toHaveBeenCalledTimes(1);
    expect(readGames.mock.calls[0]?.[0]).toEqual(["g1", "rep", "dis", "mod", "live", "gone"]);
  });
});

describe("runAndLogGameVideoRetention", () => {
  const logger = () => ({ log: vi.fn(), error: vi.fn() });

  it("logs the summary as one JSON line", async () => {
    const log = logger();
    await runAndLogGameVideoRetention(() => deps({ objects: [] }), { enabled: false, nowMs: NOW }, log);
    expect(JSON.parse(log.log.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "game_video_retention",
      scanned: 0,
    });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs an abort as an error", async () => {
    const log = logger();
    const d = () => deps({ objects: [old("games/g1/turn-1/set-u.mp4")], games: {} });
    await runAndLogGameVideoRetention(d, { enabled: true, nowMs: NOW }, log);
    expect(log.error).toHaveBeenCalledWith(
      JSON.stringify({ event: "game_video_retention_aborted", code: "no_live_games" }),
    );
  });

  it("logs a failure by safe code only and does not rethrow", async () => {
    const log = logger();
    const failing = () => ({
      ...deps({ objects: [] }),
      listGameObjects: async () => {
        throw Object.assign(new Error("games/g1/turn-1/set-SECRETUID.mp4 denied"), { code: 7 });
      },
    });
    await runAndLogGameVideoRetention(failing, { enabled: true, nowMs: NOW }, log);
    expect(log.error).toHaveBeenCalledWith(JSON.stringify({ event: "game_video_retention_failed", code: "code-7" }));
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("SECRETUID");
  });

  it("catches a throw while building the dependencies", async () => {
    const log = logger();
    await runAndLogGameVideoRetention(
      () => {
        throw new TypeError("no bucket");
      },
      { enabled: true, nowMs: NOW },
      log,
    );
    expect(log.error).toHaveBeenCalledWith(JSON.stringify({ event: "game_video_retention_failed", code: "TypeError" }));
  });

  it("defaults to console", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAndLogGameVideoRetention(() => deps({ objects: [] }), { enabled: false, nowMs: NOW });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

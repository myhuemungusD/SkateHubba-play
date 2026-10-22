/**
 * Daily retention for turn videos under `games/` (Storage).
 *
 * Policy (Jason, 2026-10-22): keep any video something still uses, delete the
 * rest. A blanket 90-day Storage lifecycle rule would also delete videos that
 * clips, disputes and reports need (docs/GAPS.md P3-2), so this job deletes a
 * `games/` object only when nothing in REFERENCE_SOURCES (references.ts) and
 * no active game pins it, and:
 *   - it is older than RETENTION_DAYS; or
 *   - its game doc no longer exists (the erasure cascade deleted the game but
 *     the objects were left behind) and it is older than ORPHAN_GRACE_MS, so
 *     an upload racing game creation is never touched.
 * A finished game's own turn fields are not references: those are the replays
 * the policy lets expire.
 *
 * Safety: a read error aborts before any delete; objects but no live games
 * (a wrong database or collection) aborts; at most MAX_DELETES_PER_RUN go per
 * run, oldest first, and the next day continues; each candidate's feed clip
 * doc is re-read just before the delete. With `enabled` false (the default)
 * it is a dry run that only counts.
 */

import { REFERENCE_SOURCES, gamePathOf, type References } from "./references.js";
import { safeErrorCode } from "./safeError.js";

export const RETENTION_DAYS = 90;
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_DELETES_PER_RUN = 500;
export const DELETE_CONCURRENCY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoredObject {
  /** Full object path, e.g. `games/abc/turn-3/set-uid.mp4`. */
  name: string;
  /** Creation time in ms since epoch. */
  createdMs: number;
}

export interface GameDoc {
  status?: unknown;
  currentTrickVideoUrl?: unknown;
  matchVideoUrl?: unknown;
}

export interface RetentionDeps {
  listGameObjects(): Promise<StoredObject[]>;
  /** Calls `visit` with each doc of `collection`, holding only `fields`. */
  forEachDoc(
    collection: string,
    fields: readonly string[],
    visit: (data: Record<string, unknown>) => void,
  ): Promise<void>;
  /** The game docs that exist, by id. */
  readGames(gameIds: string[]): Promise<Map<string, GameDoc>>;
  /** Which of these `clips` doc ids exist. */
  existingClipIds(clipIds: string[]): Promise<Set<string>>;
  deleteObject(name: string): Promise<void>;
}

export interface RetentionSummary {
  dryRun: boolean;
  aborted?: "no_live_games";
  scanned: number;
  /** Kept: a path reference, a pinned game, or an active game's current turn. */
  kept: number;
  expired: number;
  orphaned: number;
  /** Past the per-run cap; next run. */
  deferred: number;
  deleted: number;
  failed: number;
  /** Failed deletes by safe error code. */
  failedCodes: Record<string, number>;
}

/** `games/{gameId}/...` → gameId, or null for anything else. */
export function gameIdOf(path: string): string | null {
  const match = /^games\/([^/]+)\/./.exec(path);
  return match ? (match[1] as string) : null;
}

/** `games/{g}/turn-{n}/{role}-{uid}.{ext}` → the feed clip id `${g}_${n}_${role}`; else null. */
export function clipIdOf(path: string): string | null {
  const match = /^games\/([^/]+)\/turn-(\d+)\/(set|match)-[^/]+$/.exec(path);
  return match ? `${match[1]}_${match[2]}_${match[3]}` : null;
}

async function collectReferences(deps: RetentionDeps): Promise<References> {
  const refs: References = { paths: new Set(), gameIds: new Set() };
  for (const source of REFERENCE_SOURCES) {
    await deps.forEachDoc(source.collection, source.fields, (data) => source.collect(data, refs));
  }
  return refs;
}

/** The current turn's videos in active games: still being judged. */
function activeTurnPaths(games: Map<string, GameDoc>): Set<string> {
  const paths = new Set<string>();
  for (const game of games.values()) {
    if (game.status !== "active") continue;
    for (const value of [game.currentTrickVideoUrl, game.matchVideoUrl]) {
      const path = gamePathOf(value);
      if (path !== null) paths.add(path);
    }
  }
  return paths;
}

async function deleteAll(deps: RetentionDeps, names: string[], summary: RetentionSummary): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < names.length) {
      const name = names[next++] as string;
      try {
        await deps.deleteObject(name);
        summary.deleted++;
      } catch (err) {
        const code = safeErrorCode(err);
        summary.failed++;
        summary.failedCodes[code] = (summary.failedCodes[code] ?? 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: DELETE_CONCURRENCY }, worker));
}

export async function runGameVideoRetention(
  deps: RetentionDeps,
  opts: { enabled: boolean; nowMs: number },
): Promise<RetentionSummary> {
  const objects = (await deps.listGameObjects()).filter((o) => gameIdOf(o.name) !== null);
  const refs = await collectReferences(deps);
  const gameIds = [...new Set(objects.map((o) => gameIdOf(o.name) as string))];
  const games = await deps.readGames(gameIds);
  const summary: RetentionSummary = {
    dryRun: !opts.enabled,
    scanned: objects.length,
    kept: 0,
    expired: 0,
    orphaned: 0,
    deferred: 0,
    deleted: 0,
    failed: 0,
    failedCodes: {},
  };
  if (gameIds.length > 0 && games.size === 0) return { ...summary, aborted: "no_live_games" };

  const active = activeTurnPaths(games);
  const candidates: StoredObject[] = [];
  for (const object of objects) {
    const gameId = gameIdOf(object.name) as string;
    if (refs.paths.has(object.name) || refs.gameIds.has(gameId) || active.has(object.name)) {
      summary.kept++;
      continue;
    }
    const age = opts.nowMs - object.createdMs;
    if (age > RETENTION_DAYS * DAY_MS) {
      summary.expired++;
      candidates.push(object);
    } else if (!games.has(gameId) && age > ORPHAN_GRACE_MS) {
      summary.orphaned++;
      candidates.push(object);
    }
  }
  candidates.sort((a, b) => a.createdMs - b.createdMs);
  summary.deferred = Math.max(0, candidates.length - MAX_DELETES_PER_RUN);
  const batch = candidates.slice(0, MAX_DELETES_PER_RUN).map((o) => o.name);

  // A feed clip made since the references were read pins its video too.
  const clipIds = [...new Set(batch.map(clipIdOf).filter((id): id is string => id !== null))];
  const newClips = await deps.existingClipIds(clipIds);
  const doomed = batch.filter((name) => {
    const clipId = clipIdOf(name);
    return clipId === null || !newClips.has(clipId);
  });
  summary.kept += batch.length - doomed.length;

  if (opts.enabled) await deleteAll(deps, doomed, summary);
  return summary;
}

/**
 * The scheduled entry point: runs the job and logs one JSON line. A failure
 * logs only a safe code (a raw Storage or Firestore message can name an object
 * `{role}-{uid}.mp4`) and does not rethrow, so the platform never logs it.
 */
export async function runAndLogGameVideoRetention(
  makeDeps: () => RetentionDeps,
  opts: { enabled: boolean; nowMs: number },
  log: Pick<Console, "log" | "error"> = console,
): Promise<void> {
  try {
    const summary = await runGameVideoRetention(makeDeps(), opts);
    if (summary.aborted) log.error(JSON.stringify({ event: "game_video_retention_aborted", code: summary.aborted }));
    else log.log(JSON.stringify({ event: "game_video_retention", ...summary }));
  } catch (err) {
    log.error(JSON.stringify({ event: "game_video_retention_failed", code: safeErrorCode(err) }));
  }
}

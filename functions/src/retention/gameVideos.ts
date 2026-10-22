/**
 * Daily retention for turn videos under `games/` (Storage).
 *
 * Policy (Jason, 2026-10-22): keep any video something still uses, delete the
 * rest. A blanket 90-day Storage lifecycle rule would also delete videos that
 * public clips, disputes and moderation reports point at (docs/GAPS.md P3-2),
 * so this job deletes a `games/` object only when:
 *   - it is older than RETENTION_DAYS and no doc in REFERENCE_COLLECTIONS
 *     points at its path; or
 *   - its game doc no longer exists (the account-erasure cascade deleted the
 *     game but the objects were left behind), it is older than ORPHAN_GRACE_MS
 *     (so an upload racing game creation is never touched), and nothing
 *     references it.
 * The game doc's own turn fields are not references: those are the replays
 * the policy lets expire.
 *
 * With `enabled` false (the default) it is a dry run: it only logs counts.
 */

export const RETENTION_DAYS = 90;
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Collections whose docs can hold a game video URL that must outlive the
 * game's own retention. Every string field (nested too) is scanned, so a new
 * field name in one of these needs no change here; a new collection does.
 */
export const REFERENCE_COLLECTIONS = [
  "clips",
  "disputes",
  "reports",
  "appeals",
  "moderationStatements",
  "trainingLabels",
] as const;

export interface StoredObject {
  /** Full object path, e.g. `games/abc/turn-3/set-uid.mp4`. */
  name: string;
  /** Creation time in ms since epoch. */
  createdMs: number;
}

export interface RetentionDeps {
  listGameObjects(): Promise<StoredObject[]>;
  /** Every doc's data in one collection. */
  readCollection(name: string): Promise<unknown[]>;
  /** Which of these game ids still have a game doc. */
  existingGameIds(gameIds: string[]): Promise<Set<string>>;
  deleteObject(name: string): Promise<void>;
}

export interface RetentionSummary {
  dryRun: boolean;
  scanned: number;
  referenced: number;
  expired: number;
  orphaned: number;
  deleted: number;
  failed: number;
}

const DOWNLOAD_PATH = /\/o\/(games%2F[^?#\s"]+)/g;
const GS_PATH = /^gs:\/\/[^/]+\/(games\/.+)$/;

/** Adds every `games/` object path found in any string inside `value`. */
export function collectGamePaths(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(DOWNLOAD_PATH)) {
      try {
        out.add(decodeURIComponent(match[1] as string));
      } catch {
        // Malformed escape: not a URL we wrote, so it references nothing.
      }
    }
    const gs = GS_PATH.exec(value);
    if (gs) out.add(gs[1] as string);
    else if (value.startsWith("games/")) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGamePaths(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectGamePaths(item, out);
  }
}

/** `games/{gameId}/...` → gameId, or null for anything else. */
export function gameIdOf(path: string): string | null {
  const match = /^games\/([^/]+)\/./.exec(path);
  return match ? (match[1] as string) : null;
}

export async function runGameVideoRetention(
  deps: RetentionDeps,
  opts: { enabled: boolean; nowMs: number },
): Promise<RetentionSummary> {
  const objects = await deps.listGameObjects();
  const references = new Set<string>();
  for (const name of REFERENCE_COLLECTIONS) {
    for (const data of await deps.readCollection(name)) collectGamePaths(data, references);
  }
  const gameIds = [...new Set(objects.map((o) => gameIdOf(o.name)).filter((id): id is string => id !== null))];
  const liveGames = await deps.existingGameIds(gameIds);

  const summary: RetentionSummary = {
    dryRun: !opts.enabled,
    scanned: objects.length,
    referenced: 0,
    expired: 0,
    orphaned: 0,
    deleted: 0,
    failed: 0,
  };
  const doomed: string[] = [];
  for (const object of objects) {
    const gameId = gameIdOf(object.name);
    if (gameId === null) continue;
    if (references.has(object.name)) {
      summary.referenced++;
      continue;
    }
    const age = opts.nowMs - object.createdMs;
    if (age > RETENTION_DAYS * DAY_MS) {
      summary.expired++;
      doomed.push(object.name);
    } else if (!liveGames.has(gameId) && age > ORPHAN_GRACE_MS) {
      summary.orphaned++;
      doomed.push(object.name);
    }
  }
  if (!opts.enabled) return summary;
  for (const name of doomed) {
    try {
      await deps.deleteObject(name);
      summary.deleted++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

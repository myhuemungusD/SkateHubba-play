/**
 * What keeps a `games/` video past retention (gameVideos.ts).
 *
 * Each source names the exact fields it reads, so the job selects only those
 * and nothing else in a doc can pin a video by accident:
 *   - a feed clip pins the one video it plays;
 *   - a dispute, a report or a moderation decision pins its whole game, since
 *     they hold ids, not paths, and the evidence is every video in the game;
 *   - a training label pins its clip only while the skater is opted in.
 * Appeals point at moderation statements, so statements cover them.
 */

export interface References {
  /** Object paths that must not be deleted. */
  paths: Set<string>;
  /** Games whose every object must not be deleted. */
  gameIds: Set<string>;
}

export interface ReferenceSource {
  collection: string;
  /** Field paths to select; `collect` reads only these. */
  fields: readonly string[];
  collect(data: Record<string, unknown>, refs: References): void;
}

const DOWNLOAD_PATH = /\/o\/(games%2[Ff][^?#\s"]+)/;
const GS_PATH = /^gs:\/\/[^/]+\/(games\/.+)$/;
/** A game id, a clip id `${gameId}_${turn}_${role}`, or a dispute id `${gameId}_${turn}`. */
const GAME_REF = /^([A-Za-z0-9]{1,128})(?:_\d+(?:_(?:set|match))?)?$/;

/** The `games/` object path a download URL, gs:// URL or raw path names; else null. */
export function gamePathOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const download = DOWNLOAD_PATH.exec(value);
  if (download) {
    try {
      return decodeURIComponent(download[1] as string);
    } catch {
      return null;
    }
  }
  const gs = GS_PATH.exec(value);
  if (gs) return gs[1] as string;
  return value.startsWith("games/") ? value : null;
}

/** The game id inside a game, clip or dispute id; else null. */
export function gameIdOfRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = GAME_REF.exec(value);
  return match ? (match[1] as string) : null;
}

function addPath(refs: References, value: unknown): void {
  const path = gamePathOf(value);
  if (path !== null) refs.paths.add(path);
}

function addGame(refs: References, value: unknown): void {
  const id = gameIdOfRef(value);
  if (id !== null) refs.gameIds.add(id);
}

export const REFERENCE_SOURCES: readonly ReferenceSource[] = [
  { collection: "clips", fields: ["videoUrl"], collect: (data, refs) => addPath(refs, data.videoUrl) },
  { collection: "disputes", fields: ["gameId"], collect: (data, refs) => addGame(refs, data.gameId) },
  {
    collection: "reports",
    fields: ["gameId", "clipId"],
    collect: (data, refs) => {
      addGame(refs, data.gameId);
      addGame(refs, data.clipId);
    },
  },
  {
    collection: "moderationStatements",
    fields: ["contentRef"],
    collect: (data, refs) => addGame(refs, data.contentRef),
  },
  {
    collection: "trainingLabels",
    fields: ["clipPath", "excluded", "consent.optedIn"],
    collect: (data, refs) => {
      const consent = data.consent as { optedIn?: unknown } | undefined;
      if (data.excluded === false && consent?.optedIn === true) addPath(refs, data.clipPath);
    },
  },
];

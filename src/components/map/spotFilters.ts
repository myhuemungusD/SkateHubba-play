import type { Spot, ObstacleType } from "../../types/spot";

/** Client-side spot filter model shared by the filter bar and the map. */

export interface SpotFilters {
  /** Case-insensitive substring match on `spot.name`. Trimmed before compare. */
  query: string;
  /** OR-match: spot passes if it has ANY of these obstacles (empty = no filter). */
  obstacles: ObstacleType[];
  /** If true, only verified spots pass. */
  verifiedOnly: boolean;
  /** Minimum gnar rating. 0 means no threshold. */
  minGnar: 0 | 3 | 4 | 5;
}

export const DEFAULT_SPOT_FILTERS: SpotFilters = {
  query: "",
  obstacles: [],
  verifiedOnly: false,
  minGnar: 0,
};

export const FILTERABLE_OBSTACLES: readonly ObstacleType[] = [
  "ledge",
  "rail",
  "stairs",
  "gap",
  "bank",
  "bowl",
  "manual_pad",
  "quarter_pipe",
  "hubba",
  "hip",
  "flatground",
] as const;

/**
 * Pure filter — exported so tests (and any future list view) can exercise the
 * exact same logic the map uses to decide which markers to render.
 */
export function applySpotFilters<T extends Spot>(spots: T[], f: SpotFilters): T[] {
  const q = f.query.trim().toLowerCase();
  const hasObstacleFilter = f.obstacles.length > 0;
  return spots.filter((s) => {
    if (q.length > 0 && !s.name.toLowerCase().includes(q)) return false;
    if (f.verifiedOnly && !s.isVerified) return false;
    if (f.minGnar > 0 && s.gnarRating < f.minGnar) return false;
    if (hasObstacleFilter && !f.obstacles.some((o) => s.obstacles.includes(o))) return false;
    return true;
  });
}

export function countActiveFilters(f: SpotFilters): number {
  let n = 0;
  if (f.obstacles.length > 0) n += 1;
  if (f.verifiedOnly) n += 1;
  if (f.minGnar > 0) n += 1;
  return n;
}

import { isExtrasEnabled } from "./featureFlags";
import { runAfterQuiet, scheduleIdle } from "./scheduleIdle";

export type RouteLoader = () => Promise<unknown>;

export interface RouteLoaders {
  feed: RouteLoader;
  map: RouteLoader;
  game: RouteLoader;
  gameOver: RouteLoader;
  me: RouteLoader;
  settings: RouteLoader;
  challenge: RouteLoader;
  myStats: RouteLoader;
}

interface ConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
}

const defaultLoaders: RouteLoaders = {
  feed: () => import("../screens/FeedScreen"),
  map: () => import("../screens/MapPage"),
  game: () => import("../screens/GamePlayScreen"),
  gameOver: () => import("../screens/GameOverScreen"),
  me: () => import("../screens/PlayerProfileScreen"),
  settings: () => import("../screens/Settings"),
  challenge: () => import("../screens/ChallengeScreen"),
  myStats: () => import("../screens/MyStatsScreen"),
};

let generation = 0;
let removeIntent: (() => void) | null = null;

export function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function connection(): ConnectionLike | undefined {
  return (navigator as Navigator & { connection?: ConnectionLike }).connection;
}

/** Data-saver and 2g skip optional chunk downloads. */
export function canPrefetch(): boolean {
  const conn = connection();
  if (!conn) return true;
  if (conn.saveData) return false;
  if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") return false;
  return true;
}

/** Mapbox is large enough that only an unconstrained 4g (or unknown) link should prefetch it. */
export function canPrefetchHeavy(): boolean {
  if (!canPrefetch()) return false;
  const type = connection()?.effectiveType;
  if (!type) return true;
  return type === "4g";
}

export function routesForPath(
  pathname: string,
  loaders: RouteLoaders,
  opts: { extras: boolean; heavy: boolean },
): RouteLoader[] {
  const path = normalizePath(pathname);
  switch (path) {
    case "/":
    case "/auth":
      return opts.extras ? [loaders.feed] : [];
    case "/feed":
      return opts.heavy ? [loaders.challenge, loaders.me, loaders.map] : [loaders.challenge, loaders.me];
    case "/lobby": {
      const next = [loaders.game, loaders.me, loaders.challenge];
      if (opts.extras) next.push(loaders.feed);
      if (opts.heavy) next.push(loaders.map);
      return next;
    }
    case "/map":
      return [loaders.me, loaders.challenge];
    case "/me":
      return [loaders.settings, loaders.myStats, loaders.challenge];
    case "/game":
      return [loaders.gameOver];
    case "/challenge":
      return [loaders.game];
    case "/settings":
      return [loaders.me];
    case "/gameover":
      return [loaders.me];
    default:
      return [];
  }
}

function cancelPending(): void {
  generation += 1;
  removeIntent?.();
  removeIntent = null;
}

function drain(token: number, queue: RouteLoader[]): void {
  if (token !== generation) return;
  const load = queue.shift();
  if (!load) return;
  void Promise.resolve()
    .then(load)
    .catch(() => undefined)
    .finally(() => {
      if (token !== generation) return;
      scheduleIdle(() => drain(token, queue), 1000);
    });
}

/**
 * Prefetch the chunks the viewer is likely to open next.
 * One chunk per idle slice so parsing doesn't pile into a long task.
 * Also arms a pointer/key listener so a tap before the quiet delay still warms the next route.
 */
export function prefetchLikelyRoutes(pathname: string, opts?: { enabled?: boolean; loaders?: RouteLoaders }): void {
  const enabled = opts?.enabled ?? import.meta.env.MODE !== "test";
  if (!enabled) return;
  const loaders = opts?.loaders ?? defaultLoaders;
  cancelPending();
  const token = generation;
  let kicked = false;
  const kick = () => {
    if (token !== generation || kicked || !canPrefetch()) return;
    kicked = true;
    const queue = routesForPath(pathname, loaders, {
      extras: isExtrasEnabled(),
      heavy: canPrefetchHeavy(),
    });
    drain(token, queue);
  };
  runAfterQuiet(kick);
  const onIntent = () => {
    removeIntent?.();
    removeIntent = null;
    scheduleIdle(kick, 1);
  };
  window.addEventListener("pointerdown", onIntent, { passive: true });
  window.addEventListener("keydown", onIntent);
  removeIntent = () => {
    window.removeEventListener("pointerdown", onIntent);
    window.removeEventListener("keydown", onIntent);
  };
}

/** @internal */
export function __resetRoutePrefetchForTest(): void {
  cancelPending();
}

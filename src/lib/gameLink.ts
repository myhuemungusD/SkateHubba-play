/**
 * The `?game=<id>` link a S.K.A.T.E. push opens on the web.
 *
 * The couriers set webpush.fcmOptions.link to https://skatehubba.com/?game=<id>
 * (functions/src/push/webpush.ts, api/cron/_pushWebpush.ts), older payloads
 * carry the same URL as notification.click_action, and the service worker
 * opens it with clients.openWindow when no tab is open. So a tap usually
 * arrives as a fresh page load with the id in the query string, before auth
 * has resolved and often before the user is signed in.
 *
 * The id is parked in sessionStorage until the app is ready to open it
 * (useGameDeepLink). sessionStorage survives the same-tab sign-in, a Google
 * redirect sign-in and a refresh, and dies with the tab, so a stale link
 * can't fire in some later session.
 */

export const GAME_LINK_PARAM = "game";

/** Firestore auto-ids are 20 chars; 128 leaves room for hand-made test ids. */
export const MAX_GAME_ID_LENGTH = 128;

/**
 * A subset of what Firestore allows in a document id: letters, digits, `_`
 * and `-`. That covers every id the app mints (auto-ids) and rules out `/`
 * (a path separator), `.`/`..`, and `__reserved__` ids before the value ever
 * reaches doc().
 */
const GAME_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

const PENDING_GAME_LINK_KEY = "skate.pendingGameLink";

export function isValidGameId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_GAME_ID_LENGTH &&
    GAME_ID_SHAPE.test(value) &&
    !/^__.*__$/.test(value)
  );
}

/** The validated game id in a location.search string, or null. */
export function readGameLinkParam(search: string): string | null {
  const value = new URLSearchParams(search).get(GAME_LINK_PARAM);
  return isValidGameId(value) ? value : null;
}

export function hasGameLinkParam(search: string): boolean {
  return new URLSearchParams(search).has(GAME_LINK_PARAM);
}

/** `search` without the game param ("" when nothing else is left). */
export function withoutGameLinkParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(GAME_LINK_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

// Private-mode Safari can throw on sessionStorage; fall back to memory so the
// link still works for this page load.
let memoryPending: string | null = null;

export function stashPendingGameLink(gameId: string): void {
  memoryPending = gameId;
  try {
    sessionStorage.setItem(PENDING_GAME_LINK_KEY, gameId);
  } catch {
    // Best effort: memoryPending still carries it for this page load.
  }
}

export function peekPendingGameLink(): string | null {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(PENDING_GAME_LINK_KEY);
  } catch {
    stored = null;
  }
  const value = stored ?? memoryPending;
  // Re-validate: sessionStorage is writable by anything on the origin.
  return isValidGameId(value) ? value : null;
}

export function clearPendingGameLink(): void {
  memoryPending = null;
  try {
    sessionStorage.removeItem(PENDING_GAME_LINK_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/**
 * Park a ?game= id from the page URL and strip the param, before the router
 * mounts (called from main.tsx). Doing it this early matters: a signed-out
 * visitor gets the boot landing (src/boot) before App and auth have loaded,
 * and its "Account"/"Create account" buttons navigate to /auth, which would
 * drop the query before App could read it. history.replaceState keeps the
 * existing history entry (no extra Back step) and its state.
 */
export function captureGameLinkFromLocation(win: Pick<Window, "location" | "history"> = window): void {
  const { pathname, search, hash } = win.location;
  if (!hasGameLinkParam(search)) return;
  const gameId = readGameLinkParam(search);
  if (gameId) stashPendingGameLink(gameId);
  win.history.replaceState(win.history.state, "", `${pathname}${withoutGameLinkParam(search)}${hash}`);
}

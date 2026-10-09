/**
 * Landing fast-path ("boot landing").
 *
 * The full app (Firebase Auth/Firestore/Storage, contexts, routes) is ~350 KB
 * of gzipped JS that used to download, parse and run — and then wait for
 * Firebase Auth to resolve — before the landing page could paint. For a
 * signed-out visitor on `/` none of that is needed to show the page, so
 * `main.tsx` paints `<BootLanding>` from a small entry chunk first and only
 * then loads `App` (see `Root` in main.tsx). The boot landing then stays
 * mounted — App drives it through the "shell bridge" below instead of
 * rendering a second copy — so nothing the visitor has already done on the
 * page (open panels, focus, video) is lost when App arrives. App releases the
 * shell once it renders anything other than the signed-out landing.
 *
 * Signed-in users must keep the old behaviour (spinner → lobby, never a flash
 * of the marketing page), so the fast path is only taken when we're confident
 * there is no session:
 *   - `sh_auth_hint` is written by AuthProvider every time auth resolves
 *     ("1" signed in / "0" signed out) — the definitive signal after the
 *     first visit.
 *   - With no hint yet, a visitor whose browser has never run the Firebase
 *     Auth SDK on this origin (no `firebaseLocalStorageDb` IndexedDB
 *     database) cannot have a session either. Anything uncertain falls back
 *     to the normal path.
 *
 * Clicks on the boot landing before App arrives are recorded here as intents
 * and replayed once App is up (auth mode for /auth, Google sign-in).
 */

export const AUTH_HINT_KEY = "sh_auth_hint";
/** Firebase Auth's IndexedDB persistence database (browserLocalPersistence). */
export const FIREBASE_AUTH_IDB_NAME = "firebaseLocalStorageDb";

/** Paths that can be served by the boot landing. */
const BOOT_PATHS: ReadonlySet<string> = new Set(["/"]);

export function writeAuthHint(signedIn: boolean): void {
  try {
    localStorage.setItem(AUTH_HINT_KEY, signedIn ? "1" : "0");
  } catch {
    // Storage disabled (private mode) — the fast path simply won't engage.
  }
}

function readAuthHint(): string | null {
  try {
    return localStorage.getItem(AUTH_HINT_KEY);
  } catch {
    return null;
  }
}

type IdbFactoryLike = { databases?: () => Promise<Array<{ name?: string }>> };

/**
 * Decide whether to paint the boot landing before loading the full app.
 * Resolves `false` whenever a session is possible or the answer is unknown.
 */
export async function shouldBootLanding(
  pathname: string,
  isNative: boolean,
  idb: IdbFactoryLike | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<boolean> {
  if (isNative || !BOOT_PATHS.has(pathname)) return false;
  const hint = readAuthHint();
  if (hint === "1") return false;
  if (hint === "0") return true;
  if (!idb || typeof idb.databases !== "function") return false;
  try {
    const dbs = await idb.databases();
    return !dbs.some((db) => db.name === FIREBASE_AUTH_IDB_NAME);
  } catch {
    return false;
  }
}

/* ── Boot state + intents ────────────────────────────── */

let booted = false;
let pendingAuthMode: "signup" | "signin" | null = null;
let pendingGoogle = false;
let pendingApple = false;

/** Called once by main.tsx with the boot decision. */
export function setLandingBooted(value: boolean): void {
  booted = value;
}

/** True when this page load painted the boot landing first. */
export function isLandingBooted(): boolean {
  return booted;
}

export function setBootAuthMode(mode: "signup" | "signin"): void {
  pendingAuthMode = mode;
}

/** Auth mode chosen on the boot landing (read by NavigationProvider's initial state). */
export function peekBootAuthMode(): "signup" | "signin" | null {
  return pendingAuthMode;
}

export function clearBootAuthMode(): void {
  pendingAuthMode = null;
}

export function requestBootGoogleSignIn(): void {
  pendingGoogle = true;
}

export function hasBootGoogleSignIn(): boolean {
  return pendingGoogle;
}

/** Returns true (once) if a Google sign-in was requested before App loaded. */
export function takeBootGoogleSignIn(): boolean {
  const was = pendingGoogle;
  pendingGoogle = false;
  return was;
}

export function requestBootAppleSignIn(): void {
  pendingApple = true;
}

export function hasBootAppleSignIn(): boolean {
  return pendingApple;
}

/** Returns true (once) if an Apple sign-in was requested before App loaded. */
export function takeBootAppleSignIn(): boolean {
  const was = pendingApple;
  pendingApple = false;
  return was;
}

/* ── Shell bridge (boot landing ⇄ App) ───────────────── */

/** Landing handlers App provides while the boot landing is on screen. */
export interface LandingBridge {
  onGo: (mode: "signup" | "signin") => void;
  onGoogle: () => void;
  googleLoading: boolean;
  onApple: () => void;
  appleLoading: boolean;
  onNav: (screen: "privacy" | "terms" | "datadeletion") => void;
}

let shellActive = true;
let bridge: LandingBridge | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeBootShell(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the boot landing is still the visible landing (App renders none). */
export function isBootShellActive(): boolean {
  return booted && shellActive;
}

/** App takes over rendering; the boot landing unmounts for good. */
export function releaseBootShell(): void {
  if (!shellActive) return;
  shellActive = false;
  bridge = null;
  emit();
}

export function setLandingBridge(next: LandingBridge | null): void {
  if (bridge === next) return;
  bridge = next;
  emit();
}

export function getLandingBridge(): LandingBridge | null {
  return bridge;
}

/** @internal test-only reset */
export function __resetLandingBootForTest(): void {
  booted = false;
  pendingAuthMode = null;
  pendingGoogle = false;
  pendingApple = false;
  shellActive = true;
  bridge = null;
  listeners.clear();
}

/* ── Scheduling helpers ──────────────────────────────── */

/**
 * Run `cb` once the boot landing is actually on screen, so the App chunk
 * (Firebase et al., ~200 KB gzipped) never competes with the landing's own
 * first paint:
 *   - Chromium: after the first largest-contentful-paint entry is reported
 *     (delivered after the frame is presented);
 *   - elsewhere: after the window `load` event plus one frame;
 *   - in any case no later than `maxWait` ms.
 */
export function afterLandingPainted(cb: () => void, maxWait = 3000): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    requestAnimationFrame(() => {
      setTimeout(cb, 0);
    });
  };
  const PO = typeof PerformanceObserver === "undefined" ? undefined : PerformanceObserver;
  if (PO?.supportedEntryTypes?.includes("largest-contentful-paint")) {
    const po = new PO(() => {
      po.disconnect();
      run();
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
  } else if (document.readyState === "complete") {
    run();
  } else {
    window.addEventListener("load", run, { once: true });
  }
  setTimeout(run, maxWait);
}

/**
 * Run `cb` when the main thread is idle (or after `timeout` ms at the latest).
 * Used to keep optional SDK bootstraps (Sentry, PostHog) off the first-paint
 * path.
 */
export function runWhenIdle(cb: () => void, timeout = 3000): void {
  const ric = (globalThis as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === "function") {
    ric(cb, { timeout });
  } else {
    setTimeout(cb, 1);
  }
}

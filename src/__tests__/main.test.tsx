import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock @capacitor/core — togglable native/web platform ─────────────── */

const { mockIsNativePlatform } = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn(() => false),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mockIsNativePlatform },
}));

/* ── mock @capacitor/splash-screen — assertable hide() ────────────────── */

const { mockHide } = vi.hoisted(() => ({
  mockHide: vi.fn(() => Promise.resolve()),
}));

vi.mock("@capacitor/splash-screen", () => ({
  SplashScreen: { hide: mockHide },
}));

/* ── mock ./lib/sentry — capture breadcrumb/init calls ────────────────── */

const { mockAddBreadcrumb, mockInitSentry, mockCaptureException } = vi.hoisted(() => ({
  mockAddBreadcrumb: vi.fn(),
  mockInitSentry: vi.fn(() => Promise.resolve()),
  mockCaptureException: vi.fn(),
}));

vi.mock("../lib/sentry", () => ({
  initSentry: mockInitSentry,
  addBreadcrumb: mockAddBreadcrumb,
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
  setUser: vi.fn(),
}));

/* ── mock ./lib/posthog — avoid network + env branches ────────────────── */

vi.mock("../lib/posthog", () => ({
  initPosthog: vi.fn(() => Promise.resolve()),
}));

/* ── mock ./services/nativeApp — main.tsx dynamically imports it on native.
   Mocking keeps this a unit test of the entry point AND stops the real
   module executing here: a second, partially-exercised load of
   nativeApp.ts registers a separate coverage entry whose branch map does
   not merge cleanly with the dedicated test's — intermittently dropping
   src/services/** branch coverage below 100% (the 99.76% CI failure). ── */

const { mockInitStatusBar, mockSubscribeToBackButton } = vi.hoisted(() => ({
  mockInitStatusBar: vi.fn(() => Promise.resolve()),
  mockSubscribeToBackButton: vi.fn(() => () => {}),
}));

vi.mock("../services/nativeApp", () => ({
  initStatusBar: mockInitStatusBar,
  subscribeToBackButton: mockSubscribeToBackButton,
}));

/* ── mock ./App — entry point under test must not boot the real tree ── */

vi.mock("../App", () => ({
  default: () => null,
}));

/* ── mock ./boot/Root and track React roots ─────────────────────────────
   The real Root paints BootLanding and schedules rAF/idle work; left
   mounted, that work ran after jsdom teardown ("window is not defined",
   "Closing rpc while onUserConsoleLog was pending") and failed the run
   after every test had passed. Root has its own tests in boot/__tests__.
   Each loaded entry's root is unmounted in afterEach once it has rendered. ── */

const { mockRootRendered, createdRoots } = vi.hoisted(() => ({
  mockRootRendered: vi.fn(),
  createdRoots: [] as Array<{ unmount: () => void }>,
}));

vi.mock("../boot/Root", () => ({
  Root: () => {
    mockRootRendered();
    return null;
  },
}));

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      createdRoots.push(root);
      return root;
    },
  };
});

/** Wait for main's async first render, then unmount every root it made. */
async function unmountRoots(): Promise<void> {
  if (createdRoots.length > 0) await vi.waitFor(() => expect(mockRootRendered).toHaveBeenCalled());
  for (const root of createdRoots.splice(0)) root.unmount();
}

/* ── mock CSS side-effect import ──────────────────────────────────────── */

vi.mock("../index.css", () => ({}));

/**
 * Helper: load `src/main.tsx` fresh for each assertion. `vi.resetModules()`
 * is required because module-level side-effects (the hide() call) run once
 * on first import and must re-run under a new `isNativePlatform` return.
 */
async function loadMain(): Promise<void> {
  const rootEl = document.createElement("div");
  rootEl.id = "root";
  document.body.appendChild(rootEl);
  await import("../main");
}

/**
 * The hide() call is scheduled via requestAnimationFrame and then awaits a
 * dynamic import() + the hide() promise. We need to flush one frame, yield
 * to the dynamic-import microtasks, and wait until the mock is observed —
 * a fixed count of microtask flushes is racy under different timer
 * implementations.
 */
async function waitForHideSettled(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  // Poll macrotask-boundaries so the dynamic imports resolve. 50 iterations
  // with a 0ms timeout is ample for already-registered vi.mock lookups.
  // Wait for BOTH native side-effects — the splash hide and the shell
  // integrations run in independent async blocks, so the first settling
  // says nothing about the second.
  for (let i = 0; i < 50; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (mockHide.mock.calls.length > 0 && mockSubscribeToBackButton.mock.calls.length > 0) return;
  }
}

describe("main entry — splash screen hide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsNativePlatform.mockReturnValue(false);
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await unmountRoots();
    document.body.innerHTML = "";
  });

  it("calls SplashScreen.hide exactly once when running on a native platform", async () => {
    mockIsNativePlatform.mockReturnValue(true);

    await loadMain();
    await waitForHideSettled();

    expect(mockHide).toHaveBeenCalledTimes(1);
    expect(mockHide).toHaveBeenCalledWith({ fadeOutDuration: 300 });
    expect(mockAddBreadcrumb).toHaveBeenCalledWith({
      category: "lifecycle",
      message: "splash_hidden",
    });

    // Shell integrations mount alongside the splash hide. Their dynamic
    // import shares the same macrotask window waitForHideSettled flushed.
    expect(mockSubscribeToBackButton).toHaveBeenCalledTimes(1);
    expect(mockInitStatusBar).toHaveBeenCalledTimes(1);
  });

  it("does not call SplashScreen.hide on the web", async () => {
    mockIsNativePlatform.mockReturnValue(false);

    await loadMain();
    // Flush any hypothetical scheduled work — rAF plus a handful of
    // macrotasks — so we'd notice if hide() were incorrectly queued.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }

    expect(mockHide).not.toHaveBeenCalled();
    expect(mockSubscribeToBackButton).not.toHaveBeenCalled();
    expect(mockInitStatusBar).not.toHaveBeenCalled();
    // And no splash lifecycle breadcrumb on web.
    const splashCrumbs = mockAddBreadcrumb.mock.calls.filter(([rawCrumb]) => {
      const crumb = rawCrumb as { message?: string } | undefined;
      return crumb?.message === "splash_hidden" || crumb?.message === "splash_hide_failed";
    });
    expect(splashCrumbs).toHaveLength(0);
  });
});

describe("main entry — push ?game= link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsNativePlatform.mockReturnValue(false);
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  afterEach(async () => {
    await unmountRoots();
    document.body.innerHTML = "";
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("parks the game id and strips the param before the router mounts", async () => {
    window.history.replaceState(null, "", "/?game=YqZNr8nWUabkLwpak0uU");
    await loadMain();
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem("skate.pendingGameLink")).toBe("YqZNr8nWUabkLwpak0uU");
  });
});

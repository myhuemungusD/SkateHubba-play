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

/* ── mock ./App — entry point under test must not boot the real tree ── */

vi.mock("../App", () => ({
  default: () => null,
}));

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
  // Poll macrotask-boundaries so the dynamic import resolves. 50 iterations
  // with a 0ms timeout is ample for an already-registered vi.mock lookup.
  for (let i = 0; i < 50; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (mockHide.mock.calls.length > 0) return;
  }
}

describe("main entry — splash screen hide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsNativePlatform.mockReturnValue(false);
    document.body.innerHTML = "";
  });

  afterEach(() => {
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
    // And no splash lifecycle breadcrumb on web.
    const splashCrumbs = mockAddBreadcrumb.mock.calls.filter(([rawCrumb]) => {
      const crumb = rawCrumb as { message?: string } | undefined;
      return crumb?.message === "splash_hidden" || crumb?.message === "splash_hide_failed";
    });
    expect(splashCrumbs).toHaveLength(0);
  });
});

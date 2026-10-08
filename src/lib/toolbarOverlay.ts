import { Capacitor } from "@capacitor/core";

/**
 * Top inset for an in-app browser that paints chrome over the webview.
 *
 * Safari (and Chrome on iOS, which uses the same WebKit toolbar model) sizes
 * the layout viewport below its address bar, so the lobby header is already
 * fully on screen. The installed PWA and the Capacitor shell do the same.
 * `--overlay-top` stays 0 there. Shifting those would double-pad.
 *
 * The Google app on iOS (user agent contains `GSA/`) draws a floating address
 * bar on top of the WKWebView. That bar is outside the webview, so
 * `env(safe-area-inset-top)` stays the device notch (often 0, because the
 * webview already starts under the status bar) and `visualViewport.offsetTop`
 * stays 0. The header then begins under the pill; on a 375×812 phone only
 * the bottoms of the header buttons clear it (~58px of overlay).
 *
 * When that webview does report a top offset, use the reported value. The
 * constant is only the fallback for the overlay it cannot see.
 */
export const GSA_TOOLBAR_FALLBACK_PX = 64;

/** Ignore sub-pixel noise. A real toolbar is much taller than this. */
const MIN_REPORTED_TOOLBAR_PX = 24;

const OVERLAY_VAR = "--overlay-top";

export interface ToolbarOverlayEnv {
  userAgent: string;
  /** Capacitor native shell. Its own contentInset already pads the webview. */
  nativeShell: boolean;
  /** Home-screen PWA. No browser toolbar is drawn over the page. */
  standalone: boolean;
  /**
   * `visualViewport.offsetTop` sampled while `scrollY` is 0. After a scroll,
   * offsetTop tracks the visual-viewport pan and is not chrome.
   */
  atRestOffsetTop: number;
}

export function isIosGoogleApp(userAgent: string): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) && /GSA\//.test(userAgent);
}

function reportedToolbar(offsetTop: number): number {
  if (!Number.isFinite(offsetTop)) return 0;
  return Math.max(0, Math.round(offsetTop));
}

export function toolbarOverlayTop(env: ToolbarOverlayEnv): number {
  // Safari, Chrome iOS, Android, the PWA, and Capacitor never enter here.
  if (env.nativeShell || env.standalone) return 0;
  if (!isIosGoogleApp(env.userAgent)) return 0;
  const reported = reportedToolbar(env.atRestOffsetTop);
  if (reported >= MIN_REPORTED_TOOLBAR_PX) return reported;
  return GSA_TOOLBAR_FALLBACK_PX;
}

function isStandalone(win: Window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  if (typeof win.matchMedia !== "function") return false;
  try {
    return win.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/**
 * Publish `--overlay-top` before first paint. Body padding and the fixed
 * top bars read it. Returns a teardown for tests.
 */
export function installToolbarOverlay(
  win: Window = window,
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): () => void {
  const root = win.document.documentElement;
  let atRestOffsetTop = 0;

  const publish = (): void => {
    const scrollY = win.scrollY || 0;
    if (scrollY <= 0) {
      atRestOffsetTop = win.visualViewport?.offsetTop ?? 0;
    }
    const top = toolbarOverlayTop({
      userAgent: win.navigator.userAgent || "",
      nativeShell: isNative(),
      standalone: isStandalone(win),
      atRestOffsetTop,
    });
    if (top <= 0) root.style.removeProperty(OVERLAY_VAR);
    else root.style.setProperty(OVERLAY_VAR, `${top}px`);
  };

  publish();
  const viewport = win.visualViewport;
  viewport?.addEventListener("resize", publish);
  viewport?.addEventListener("scroll", publish);
  win.addEventListener("orientationchange", publish);

  return () => {
    viewport?.removeEventListener("resize", publish);
    viewport?.removeEventListener("scroll", publish);
    win.removeEventListener("orientationchange", publish);
    root.style.removeProperty(OVERLAY_VAR);
  };
}

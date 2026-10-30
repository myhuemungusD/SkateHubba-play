import { Capacitor } from "@capacitor/core";

/**
 * iOS Dynamic Type for the WKWebView shell.
 *
 * WebKit exposes the user's Text Size setting through the system font
 * keyword `-apple-system-body`: at the default size it resolves to 17px and
 * it grows/shrinks with Settings › Display & Brightness › Text Size (and the
 * larger Accessibility sizes). Every app size is rem-based, so scaling the
 * root font-size by `body / 17` makes the whole UI follow that setting while
 * the default size stays exactly 16px.
 *
 * Native iOS only: desktop Safari resolves the same keyword to a fixed 13px,
 * which would shrink the app, and Android has its own text zoom.
 */
const IOS_DEFAULT_BODY_PX = 17;
/** Keep huge Accessibility sizes from breaking fixed-height chrome. */
const MAX_SCALE = 1.5;
/** Never shrink below the default: smaller iOS Text Size would push 12px labels under the type floor. */
const MIN_SCALE = 1;

/** Root font-size (px) for a measured `-apple-system-body` size. */
export function rootFontSizeFor(bodyPx: number): number {
  if (!Number.isFinite(bodyPx) || bodyPx <= 0) return 16;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, bodyPx / IOS_DEFAULT_BODY_PX));
  return Math.round(16 * scale * 100) / 100;
}

function measureBodyPx(doc: Document): number {
  const probe = doc.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;font:-apple-system-body";
  doc.body.appendChild(probe);
  const px = parseFloat(doc.defaultView?.getComputedStyle(probe).fontSize ?? "");
  probe.remove();
  return px;
}

/**
 * Apply the Dynamic Type scale now and again whenever the app comes back to
 * the foreground (the user may have changed Text Size in Settings). Returns
 * a teardown. No-op off native iOS.
 */
export function installDynamicType(
  win: Window = window,
  platform: () => string = () => Capacitor.getPlatform(),
): () => void {
  if (platform() !== "ios") return () => {};
  const doc = win.document;
  const apply = (): void => {
    if (doc.visibilityState === "hidden") return;
    const size = rootFontSizeFor(measureBodyPx(doc));
    if (size === 16) doc.documentElement.style.removeProperty("font-size");
    else doc.documentElement.style.fontSize = `${size}px`;
  };
  apply();
  doc.addEventListener("visibilitychange", apply);
  return () => {
    doc.removeEventListener("visibilitychange", apply);
    doc.documentElement.style.removeProperty("font-size");
  };
}

/**
 * Native bridge for share / clipboard / network — the three browser APIs the
 * Capacitor WebViews get wrong.
 *
 *  - `navigator.share` is absent in the Android System WebView (Web Share is
 *    gated to top-level browsing contexts with a user-visible origin), so the
 *    invite/share buttons silently degrade to the clipboard path on native.
 *  - `navigator.clipboard.writeText` needs a secure context + focus; in the
 *    WebView it intermittently rejects.
 *  - `navigator.onLine` in WKWebView is effectively pinned to `true` — it does
 *    not observe the OS reachability state, so offline UI never appears on iOS.
 *
 * Following the services-layer rule from CLAUDE.md, this is the ONLY file
 * allowed to import @capacitor/share, @capacitor/clipboard and
 * @capacitor/network. The imports are dynamic and guarded by
 * `Capacitor.isNativePlatform()` so the plugins stay out of the web bundle.
 *
 * Every export is safe to call on web: it falls back to the browser API that
 * the call site used before (identical behavior and identical error
 * semantics — a user-cancelled share still rejects, because the callers
 * render that as "Share failed"). A native plugin that fails to load is
 * logged and degrades to the same web path.
 */

import { Capacitor } from "@capacitor/core";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/** How a share was ultimately delivered — call sites report this to analytics. */
export type ShareMethod = "native_share" | "native_share_text" | "clipboard";

export interface ShareTextOptions {
  title?: string;
  /** Message to share. Used verbatim when `files` are attached. */
  text: string;
  /** Optional link, passed as the Web Share `url` field. */
  url?: string;
  /** Web Share Level 2 attachments. Web-only — the native sheet takes text. */
  files?: File[];
  /**
   * Message used when the attachments cannot be shared (no Web Share Level 2,
   * or the native path, which shares text only). Defaults to `text`.
   */
  textWithoutFiles?: string;
}

/**
 * True when a share sheet can be opened at all. On native that is always the
 * case (the OS sheet is a plugin call); on web it depends on `navigator.share`,
 * which is what the call sites gated their Share button on before.
 */
export function isShareAvailable(): boolean {
  return Capacitor.isNativePlatform() || typeof navigator.share === "function";
}

/**
 * Open a share sheet, resolving with the method actually used.
 *
 * Native: the OS sheet via @capacitor/share (text + url; files are not
 * forwarded — the plugin takes filesystem URLs, not in-memory `File`s).
 * Web: the pre-existing chain — Web Share with files → Web Share text-only →
 * clipboard copy.
 *
 * Rejects when the user cancels or the sheet fails, same as `navigator.share`.
 */
export async function shareText(options: ShareTextOptions): Promise<ShareMethod> {
  const { title, text, url, files, textWithoutFiles } = options;
  const plainText = textWithoutFiles ?? text;

  if (Capacitor.isNativePlatform()) {
    const nativeShare = await loadNativeShare();
    if (nativeShare) {
      await nativeShare({ ...(title ? { title } : {}), text: plainText, ...(url ? { url } : {}) });
      return "native_share_text";
    }
    // Plugin unavailable — fall through to the web chain below.
  }

  if (files && typeof navigator.share === "function" && navigator.canShare?.({ files })) {
    await navigator.share({ ...(title ? { title } : {}), text, ...(url ? { url } : {}), files });
    return "native_share";
  }

  if (typeof navigator.share === "function") {
    await navigator.share({ ...(title ? { title } : {}), text: plainText, ...(url ? { url } : {}) });
    return "native_share_text";
  }

  await navigator.clipboard.writeText(plainText);
  return "clipboard";
}

/** Share a link. Thin alias of {@link shareText} for link-only call sites. */
export async function shareUrl(options: { title?: string; text: string; url: string }): Promise<ShareMethod> {
  return shareText(options);
}

/**
 * Copy text to the clipboard. Uses the native Clipboard plugin inside the
 * Capacitor shell, `navigator.clipboard` on web. Rejects on failure so call
 * sites can keep showing their "could not copy" affordance.
 */
export async function copyText(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Clipboard } = await import("@capacitor/clipboard");
      await Clipboard.write({ string: text });
      return;
    } catch (err) {
      logger.warn("native_clipboard_failed", { error: parseFirebaseError(err) });
      // Fall through — navigator.clipboard may still work in the WebView.
    }
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Load the native share function, or `null` when the plugin is unavailable.
 * Kept separate from the `Share.share()` call itself so that a user-cancelled
 * share rejects (as it must) instead of being mistaken for a missing plugin.
 */
async function loadNativeShare(): Promise<
  ((opts: { title?: string; text: string; url?: string }) => Promise<unknown>) | null
> {
  try {
    const { Share } = await import("@capacitor/share");
    return (opts) => Share.share(opts);
  } catch (err) {
    logger.warn("native_share_unavailable", { error: parseFirebaseError(err) });
    return null;
  }
}

/* ── Network status ────────────────────────── */

/**
 * Last status reported by the native Network plugin. `null` means "no native
 * listener is active", in which case `navigator.onLine` is authoritative.
 */
let nativeOnline: boolean | null = null;

/**
 * Current connectivity, synchronously — the `getSnapshot` half of a
 * `useSyncExternalStore` pair. Native uses the value pushed by the Network
 * plugin; web (and native before the first plugin callback) uses
 * `navigator.onLine`.
 */
export function getNetworkSnapshot(): boolean {
  return nativeOnline ?? navigator.onLine;
}

/**
 * Subscribe to connectivity changes. Native listens to the OS reachability
 * feed via @capacitor/network; web keeps the `online`/`offline` window events.
 * Returns an unsubscribe function; safe to call on either platform.
 */
export function subscribeToNetworkStatus(cb: () => void): () => void {
  if (!Capacitor.isNativePlatform()) {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  }

  let removed = false;
  const handle = (async () => {
    const { Network } = await import("@capacitor/network");
    // Seed the cache before the first change event: the OS may already be
    // offline when the app mounts, and WKWebView's navigator.onLine won't say so.
    const status = await Network.getStatus();
    if (removed) return null;
    nativeOnline = status.connected;
    cb();
    return Network.addListener("networkStatusChange", (s) => {
      nativeOnline = s.connected;
      cb();
    });
  })().catch((err: unknown) => {
    logger.warn("network_listener_failed", { error: parseFirebaseError(err) });
    return null;
  });

  return () => {
    if (removed) return;
    removed = true;
    nativeOnline = null;
    void handle.then((h) => h?.remove()).catch(() => {});
  };
}

/**
 * Clip stills.
 *
 * Players show the clip's OWN first frame, never a stock image: iOS WKWebView
 * does not paint a frame for `preload="metadata"` on its own, so we add a
 * media fragment (`#t=0.1`) that makes WebKit seek to — and draw — the frame
 * at 0.1s. Before this, every player used the landing promo still, so a
 * player's own trick showed someone else's skater until they pressed play.
 *
 * Anything that needs a still image with no clip to read from (feed cards
 * before their video mounts, players whose src is set later) uses the plain
 * branded placeholder below. The landing page keeps its promo poster
 * (`LANDING_VIDEO_POSTER`); do not point clip UI at it.
 */
export const CLIP_PLACEHOLDER = "/clip-placeholder.webp";

/** Seconds into the clip used for the first-frame still. */
export const FIRST_FRAME_SECONDS = 0.1;

/**
 * Append a `t=` media fragment so the player renders the clip's first frame.
 * The query string (Firebase `?alt=media&token=…`) is untouched because the
 * fragment comes after it. An existing fragment is extended, and one that
 * already has a `t=` time is left alone.
 */
export function withFirstFrame(url: string): string {
  if (!url) return url;
  const hashAt = url.indexOf("#");
  if (hashAt === -1) return `${url}#t=${FIRST_FRAME_SECONDS}`;
  const fragment = url.slice(hashAt + 1);
  if (fragment.split("&").some((part) => part.startsWith("t="))) return url;
  if (fragment === "") return `${url}t=${FIRST_FRAME_SECONDS}`;
  return `${url}&t=${FIRST_FRAME_SECONDS}`;
}

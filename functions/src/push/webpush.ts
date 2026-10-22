/**
 * Web push options for every courier send.
 *
 * WHY: a message with a `notification` block is shown by the Firebase SDK in
 * the browser's service worker, not by our own code
 * (public/firebase-messaging-sw.js returns early for those). The SDK's
 * notification only opens something on tap when the message carries
 * webpush.fcmOptions.link, and only shows our icon and per-game tag when
 * webpush.notification sets them. Without these, a web push showed twice and
 * the SDK's copy did nothing when tapped.
 *
 * The link uses the same routes as the service worker's click handler:
 * /dice/<id> for Roll Dice (data.kind === "dice"), /?game=<id> for a
 * S.K.A.T.E. game, / when there is no game. Native tokens ignore `webpush`.
 *
 * Mirrored in api/cron/_pushWebpush.ts for the Vercel courier; a drift test
 * (src/services/__tests__/pushWebpush.drift.test.ts) keeps the two equal.
 */

/** Production origin. Must be HTTPS: FCM rejects any other fcmOptions.link. */
export const WEB_PUSH_ORIGIN = "https://skatehubba.com";
export const WEB_PUSH_ICON = "/icon-192.png";

export interface WebpushOptions {
  fcmOptions: { link: string };
  notification: { icon: string; badge: string; tag: string; renotify: boolean };
}

function gameIdOf(data: Readonly<Record<string, string>>): string | null {
  const id = data.gameId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Absolute URL a tap on this push opens. */
export function webPushLink(data: Readonly<Record<string, string>>): string {
  const gameId = gameIdOf(data);
  if (!gameId) return `${WEB_PUSH_ORIGIN}/`;
  const id = encodeURIComponent(gameId);
  return data.kind === "dice" ? `${WEB_PUSH_ORIGIN}/dice/${id}` : `${WEB_PUSH_ORIGIN}/?game=${id}`;
}

/** The `webpush` block for messaging.sendEachForMulticast. */
export function webpushOptions(data: Readonly<Record<string, string>>): WebpushOptions {
  const gameId = gameIdOf(data);
  return {
    fcmOptions: { link: webPushLink(data) },
    notification: {
      icon: WEB_PUSH_ICON,
      badge: WEB_PUSH_ICON,
      // Same tag as the service worker: a newer push for a game replaces the older one.
      tag: gameId ? `game_${gameId}` : "skatehubba",
      renotify: true,
    },
  };
}

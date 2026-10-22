/**
 * The game a service-worker message asks to open, or null. firebase-messaging-sw.js
 * posts `{ type: "OPEN_GAME", gameId, kind? }` for data-only pushes it draws. A push
 * with a `notification` block is drawn by the Firebase SDK, which on tap posts
 * `{ messageType: "notification-clicked", isFirebaseMessaging: true, data }`.
 */
export function openGameTarget(msg: unknown): { gameId: string; kind?: string } | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  let source: Record<string, unknown> | null = null;
  if (m.type === "OPEN_GAME") source = m;
  else if (m.messageType === "notification-clicked" && m.isFirebaseMessaging === true) {
    source = m.data && typeof m.data === "object" ? (m.data as Record<string, unknown>) : null;
  }
  if (!source) return null;
  const gameId = source.gameId;
  if (typeof gameId !== "string" || gameId.length === 0) return null;
  const kind = typeof source.kind === "string" && source.kind.length > 0 ? source.kind : undefined;
  return kind ? { gameId, kind } : { gameId };
}

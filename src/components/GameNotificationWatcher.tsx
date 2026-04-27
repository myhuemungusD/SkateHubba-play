import { useEffect, useRef } from "react";
import { useAuthContext } from "../context/AuthContext";
import { useGameContext } from "../context/GameContext";
import { useNotifications } from "../context/NotificationContext";
import { onForegroundMessage } from "../services/fcm";
import { subscribeToNudges, subscribeToNotifications } from "../services/notifications";
import type { GameDoc } from "../services/games";
import type { ChimeType } from "../services/sounds";

/**
 * CustomEvent name used by the service-worker deep-link bridge.
 * Imported by App.tsx; do not inline as a string elsewhere.
 */
export const OPEN_GAME_EVENT = "skatehubba:open-game";

/** Maps a notification doc / FCM `data.type` to the chime that should play. */
const CHIME_BY_TYPE: Record<string, ChimeType> = {
  nudge: "nudge",
  your_turn: "your_turn",
  new_challenge: "new_challenge",
  game_won: "game_won",
  game_lost: "game_lost",
  judge_invite: "general",
};

/**
 * FCM `data.type` values whose toast is already produced by an in-app
 * Firestore subscription (the `/notifications` listener or the `/nudges`
 * listener). FCM is still required for background/closed-tab pushes; in the
 * foreground these would double-toast, so we suppress them here. Unknown
 * types pass through as a "general" fallback so a future server-pushed type
 * is never silently dropped.
 */
const FIRESTORE_HANDLED_FCM_TYPES = new Set([
  "nudge",
  "your_turn",
  "new_challenge",
  "game_won",
  "game_lost",
  "judge_invite",
]);

/**
 * Notification doc `type` values whose toast is produced by
 * useGameCompletionWatcher from the games snapshot. The games-diff path is
 * canonical for completions because it catches every active -> non-active
 * transition, including paths that don't write a notification doc:
 *   • `forfeitExpiredTurn` (no notification written)
 *   • `resolveDispute` game-over (only the matcher gets `game_lost`; the
 *     setter who wins receives no doc)
 * Suppressing these in the /notifications listener keeps a single toast
 * per completion regardless of which path produced the event.
 */
const LOCALLY_HANDLED_NOTIFICATION_TYPES = new Set(["game_won", "game_lost"]);

type Notify = ReturnType<typeof useNotifications>["notify"];

/**
 * Subscribe to /notifications docs and surface them as toasts.
 *
 * This is the canonical source for game-event toasts: every relevant
 * in-transaction game mutation writes a notification doc (see
 * `services/games.{create,match,judge}.ts`), so the watcher does not need
 * to diff game state for those events.
 */
function useNotificationDocListener(uid: string | null, gated: boolean, notify: Notify) {
  useEffect(() => {
    if (!uid || !gated) return;
    return subscribeToNotifications(uid, (notif) => {
      if (LOCALLY_HANDLED_NOTIFICATION_TYPES.has(notif.type)) return;
      notify({
        type: "game_event",
        title: notif.title,
        message: notif.body,
        chime: CHIME_BY_TYPE[notif.type] ?? "general",
        gameId: notif.gameId,
        firestoreId: notif.firestoreId,
      });
    });
  }, [uid, gated, notify]);
}

/** Subscribe to /nudges docs and surface them as toasts. */
function useNudgeListener(uid: string | null, gated: boolean, notify: Notify) {
  useEffect(() => {
    if (!uid || !gated) return;
    return subscribeToNudges(uid, (nudge) => {
      notify({
        type: "game_event",
        title: "You got nudged!",
        message: `@${nudge.senderUsername} is waiting for your move`,
        chime: "nudge",
        gameId: nudge.gameId,
      });
    });
  }, [uid, gated, notify]);
}

/**
 * Game completion watcher — the canonical source for "game over" toasts.
 *
 * Diffs the games snapshot for any `active -> {complete, forfeit}` transition
 * and fires exactly one toast per game id. This path is canonical (rather
 * than the /notifications doc) because two service-layer flows skip the
 * notification write for one of the participants:
 *   • `forfeitExpiredTurn` writes no notification doc at all.
 *   • `resolveDispute` game-over writes `game_lost` only to the matcher;
 *     the setter who wins gets no doc.
 * Watching the games snapshot covers all four (won/lost × complete/forfeit)
 * uniformly and keeps the LOCALLY_HANDLED_NOTIFICATION_TYPES suppression
 * in `useNotificationDocListener` as a single dedup point.
 *
 * If `forfeitExpiredTurn` AND `resolveDispute` are ever updated to write
 * notification docs for every affected player, this watcher (and the
 * suppression set) can be removed entirely.
 *
 * Dedup across the active-game pointer and the games list is handled by a
 * `seen` set; whichever subscription delivers the transition first claims it.
 */
function useGameCompletionWatcher(uid: string | null, games: GameDoc[], activeGame: GameDoc | null, notify: Notify) {
  const prevStatusRef = useRef<Map<string, GameDoc["status"]>>(new Map());
  const seenCompletionRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) {
      prevStatusRef.current.clear();
      seenCompletionRef.current.clear();
      return;
    }

    const prev = prevStatusRef.current;
    const seen = seenCompletionRef.current;
    const activeId = activeGame?.id;

    const visit = (g: GameDoc) => {
      const prevStatus = prev.get(g.id);

      if (prevStatus === undefined) {
        // First observation — never notify on seed. Pre-seed already-terminal
        // games into the seen set so a reload mid-completed-game does not
        // surface a stale completion as new.
        prev.set(g.id, g.status);
        if (g.status !== "active") seen.add(g.id);
        return;
      }

      if (prevStatus === "active" && g.status !== "active" && !seen.has(g.id)) {
        seen.add(g.id);
        const won = g.winner === uid;
        const isForfeit = g.status === "forfeit";
        const opponentName = g.player1Uid === uid ? g.player2Username : g.player1Username;
        notify({
          type: won ? "success" : "game_event",
          title: won ? (isForfeit ? "Opponent Forfeited!" : "You Won!") : isForfeit ? "Time Expired" : "Game Over",
          message: `vs @${opponentName}`,
          chime: won ? "game_won" : "game_lost",
          gameId: g.id,
        });
      }

      prev.set(g.id, g.status);
    };

    // Visit the active game first (it can update ahead of the list when
    // `subscribeToGame` fires before `subscribeToMyGames`), then the list,
    // skipping the active id to avoid double-visiting the same game.
    if (activeGame) visit(activeGame);
    for (const g of games) {
      if (g.id === activeId) continue;
      visit(g);
    }
  }, [uid, games, activeGame, notify]);
}

/**
 * Bridge service-worker notification taps into App.tsx via a typed
 * CustomEvent. App.tsx owns the gameId → GameDoc resolution and the
 * NavigationContext call.
 */
function useServiceWorkerDeepLink(uid: string | null) {
  useEffect(() => {
    if (!uid) return;
    const sw = navigator.serviceWorker;
    if (!sw) return;

    const handler = (event: MessageEvent) => {
      // Defense-in-depth: when the tab is controlled, drop messages from any
      // SW other than its controller. When uncontrolled (controller === null,
      // common on cold-start / first install / after an SW update),
      // firebase-messaging-sw.js posts into this tab via
      // `clients.matchAll({ includeUncontrolled: true })` — there is no
      // controller to compare against, so allow the message through and
      // rely on the data-shape check below.
      if (sw.controller && event.source && event.source !== sw.controller) return;
      if (event.data?.type !== "OPEN_GAME") return;
      const gameId = event.data.gameId;
      if (typeof gameId !== "string" || gameId.length === 0) return;
      window.dispatchEvent(new CustomEvent(OPEN_GAME_EVENT, { detail: { gameId } }));
    };

    sw.addEventListener("message", handler);
    return () => sw.removeEventListener("message", handler);
  }, [uid]);
}

/**
 * Foreground FCM bridge. FCM is still required for background/closed-tab
 * delivery; in the foreground its only job is to surface unknown/future
 * types that no Firestore subscription covers.
 */
function useFcmForegroundBridge(uid: string | null, notify: Notify) {
  useEffect(() => {
    if (!uid) return;

    return onForegroundMessage((payload) => {
      const { notification, data } = payload;
      if (!notification) return;

      const fcmType = data?.type ?? "";
      if (FIRESTORE_HANDLED_FCM_TYPES.has(fcmType)) return;

      notify({
        type: "game_event",
        title: notification.title ?? "SkateHubba",
        message: notification.body ?? "",
        chime: CHIME_BY_TYPE[fcmType] ?? "general",
        gameId: data?.gameId,
      });
    });
  }, [uid, notify]);
}

/**
 * Composes the listeners that turn realtime events into in-app toasts.
 * Renders nothing. Must live inside AuthProvider, GameProvider, and
 * NotificationProvider.
 */
export function GameNotificationWatcher() {
  const { user, activeProfile } = useAuthContext();
  const { games, activeGame } = useGameContext();
  const { notify } = useNotifications();

  const uid = user?.uid ?? null;
  // /nudges and /notifications reads require the user's profile doc to exist
  // (rules dereference it). Holding the subscriptions until the profile lands
  // prevents permission-denied snapshots during signup.
  const profileGated = activeProfile != null;

  useNotificationDocListener(uid, profileGated, notify);
  useNudgeListener(uid, profileGated, notify);
  useGameCompletionWatcher(uid, games, activeGame, notify);
  useServiceWorkerDeepLink(uid);
  useFcmForegroundBridge(uid, notify);

  return null;
}

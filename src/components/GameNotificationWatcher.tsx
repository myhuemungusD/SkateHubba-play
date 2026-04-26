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
 * Forfeit fallback — the one game lifecycle event that does NOT write a
 * notification doc. `forfeitExpiredTurn` flips a game's status from `active`
 * to `forfeit` in a transaction with no `writeNotificationInTx` call, so the
 * `/notifications` listener never fires for forfeits. We watch the games
 * snapshot for the transition and fire exactly one toast per game id.
 *
 * Dedup across the active-game pointer and the games list is handled by a
 * `seen` set; whichever subscription delivers the transition first claims it.
 */
function useForfeitFallbackWatcher(uid: string | null, games: GameDoc[], activeGame: GameDoc | null, notify: Notify) {
  const prevStatusRef = useRef<Map<string, GameDoc["status"]>>(new Map());
  const seenForfeitRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) {
      prevStatusRef.current.clear();
      seenForfeitRef.current.clear();
      return;
    }

    const prev = prevStatusRef.current;
    const seen = seenForfeitRef.current;
    const activeId = activeGame?.id;

    const visit = (g: GameDoc) => {
      const prevStatus = prev.get(g.id);

      if (prevStatus === undefined) {
        // First time we observe this game — never notify on seed. Pre-seed
        // an already-forfeit game into the seen set so a snapshot landing
        // mid-session doesn't surface a stale completion as new.
        prev.set(g.id, g.status);
        if (g.status === "forfeit") seen.add(g.id);
        return;
      }

      if (prevStatus === "active" && g.status === "forfeit" && !seen.has(g.id)) {
        seen.add(g.id);
        const won = g.winner === uid;
        const opponentName = g.player1Uid === uid ? g.player2Username : g.player1Username;
        notify({
          type: won ? "success" : "game_event",
          title: won ? "Opponent Forfeited!" : "Time Expired",
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
      // Defense-in-depth: only trust messages from our controlling SW.
      // Other windows / extensions can also post into this channel.
      if (event.source && event.source !== sw.controller) return;
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
  useForfeitFallbackWatcher(uid, games, activeGame, notify);
  useServiceWorkerDeepLink(uid);
  useFcmForegroundBridge(uid, notify);

  return null;
}

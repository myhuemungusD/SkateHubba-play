import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuthContext } from "../context/AuthContext";
import { useNavigationContext, type Screen } from "../context/NavigationContext";
import { useGameContext } from "../context/GameContext";
import { useNotifications } from "../context/NotificationContext";
import { OPEN_GAME_EVENT } from "../components/GameNotificationWatcher";
import { loadNotificationGame, type NotificationGameResult } from "../services/notifications";
import { logger } from "../services/logger";
import type { GameDoc } from "../services/games";
import { useOnlineStatus } from "./useOnlineStatus";
import { GAME_ACCESS_DENIED_TOAST, GAME_LINK_LOAD_FAILED_TOAST } from "../lib/gameToasts";
import { clearPendingGameLink, isValidGameId, peekPendingGameLink, stashPendingGameLink } from "../lib/gameLink";

/** Screens the auth router moves a user off of once they're signed in with a profile. */
const PRE_APP_SCREENS = new Set<Screen>(["landing", "auth", "profile"]);

function canOpen(game: GameDoc, uid: string): boolean {
  return game.player1Uid === uid || game.player2Uid === uid || game.judgeId === uid;
}

/**
 * Opens the S.K.A.T.E. game a push notification points at, on every path a
 * tap can arrive by:
 *
 * - Web, no tab open: the browser loads /?game=<id> (fcmOptions.link,
 *   click_action, or the service worker's openWindow). main.tsx parks the id
 *   and strips the param before the router mounts
 *   (lib/gameLink captureGameLinkFromLocation), so this hook only reads the
 *   parked id. Nothing navigates to ?game= inside the app: native universal
 *   links to "/" are routed to a bare "/" (GameNotificationWatcher) and
 *   native taps use data.gameId.
 * - Web, tab open, and native (Capacitor) taps: GameNotificationWatcher turns
 *   them into OPEN_GAME_EVENT, which parks the id the same way.
 *
 * A parked id is opened once the user is signed in, has a profile and the auth
 * router has left landing/auth/profile, so a signed-out tap survives sign-in.
 * The game comes from the loaded lobby list or, on a cold start where that
 * list hasn't arrived yet, from a one-off read. A game that's gone or that
 * this account isn't in lands on the lobby with the access-denied toast. A
 * read that failed (offline) keeps the link, shows a neutral toast, and
 * retries when the device comes back online, unless the user has opened a
 * different game in the meantime.
 *
 * Roll Dice links use /dice/<id> routes and only need a navigation.
 */
export function useGameDeepLink(): void {
  const { user, activeProfile } = useAuthContext();
  const { screen, setScreen } = useNavigationContext();
  const { games, openGame, activeGame } = useGameContext();
  const { notify } = useNotifications();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  const [pending, setPending] = useState<string | null>(peekPendingGameLink);

  // The last read failed: hold the link until the device reports a connection
  // again. Cleared during render (React's "adjust state when a prop changes"
  // pattern) so the open effect below retries in the same commit.
  const [stalled, setStalled] = useState(false);
  const [seenOnline, setSeenOnline] = useState(online);
  if (seenOnline !== online) {
    setSeenOnline(online);
    if (online) setStalled(false);
  }
  // The game that was open when a read failed (undefined: no retry pending).
  // A retry that finds the user has since opened another game drops the link
  // rather than pulling them out of it.
  const retryFrom = useRef<string | null | undefined>(undefined);

  // Latest values for the effects below, which must not re-run (and
  // re-fetch) every time the games snapshot or a toast changes them.
  const activeGameId = activeGame?.id ?? null;
  const latest = useRef({ games, openGame, notify, setScreen, activeGameId });
  useEffect(() => {
    latest.current = { games, openGame, notify, setScreen, activeGameId };
  });

  // In-app taps (service worker postMessage, native push).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ gameId?: unknown; kind?: unknown } | null>).detail ?? {};
      const gameId = detail.gameId;
      if (!isValidGameId(gameId)) return;
      if (detail.kind === "dice") {
        navigate(`/dice/${gameId}`);
        return;
      }
      // Already on it. The Firebase SDK posts its notification-clicked
      // message 3 s after openWindow, by which time the parked link has
      // usually opened the game; don't push a second /game entry.
      if (latest.current.activeGameId === gameId) return;
      // A fresh tap is a fresh intent: try it now, even if an earlier read failed.
      retryFrom.current = undefined;
      setStalled(false);
      stashPendingGameLink(gameId);
      setPending(gameId);
    };
    window.addEventListener(OPEN_GAME_EVENT, handler);
    return () => window.removeEventListener(OPEN_GAME_EVENT, handler);
  }, [navigate]);

  const uid = user?.uid ?? null;
  // Signed in but no profile yet, or the auth router hasn't moved off
  // landing/auth/profile: opening now would be undone by its redirect.
  const waiting = activeProfile === null || PRE_APP_SCREENS.has(screen);

  useEffect(() => {
    if (uid === null || waiting || pending === null || stalled) return;
    let cancelled = false;
    const cached = latest.current.games.find((g) => g.id === pending);
    const load: Promise<NotificationGameResult> = cached
      ? Promise.resolve({ status: "found", game: cached })
      : loadNotificationGame(pending);
    void load.then((result) => {
      if (cancelled) return;
      if (result.status === "failed") {
        // Couldn't reach Firestore. Keep the parked id (it also survives a
        // refresh) and say so plainly instead of claiming there's no access.
        logger.info("game_link_load_failed", { gameId: pending });
        retryFrom.current = latest.current.activeGameId;
        setStalled(true);
        latest.current.notify(GAME_LINK_LOAD_FAILED_TOAST);
        return;
      }
      const movedOn = retryFrom.current !== undefined && latest.current.activeGameId !== retryFrom.current;
      retryFrom.current = undefined;
      clearPendingGameLink();
      setPending(null);
      if (movedOn) {
        logger.info("game_link_dropped_user_moved_on", { gameId: pending });
        return;
      }
      if (result.status === "found" && canOpen(result.game, uid)) {
        latest.current.openGame(result.game);
        return;
      }
      logger.info("game_link_unavailable", { gameId: pending });
      latest.current.setScreen("lobby");
      latest.current.notify(GAME_ACCESS_DENIED_TOAST);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, waiting, pending, stalled]);
}

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuthContext } from "../context/AuthContext";
import { useNavigationContext, type Screen } from "../context/NavigationContext";
import { useGameContext } from "../context/GameContext";
import { useNotifications } from "../context/NotificationContext";
import { OPEN_GAME_EVENT } from "../components/GameNotificationWatcher";
import { getNotificationGame } from "../services/notifications";
import { logger } from "../services/logger";
import type { GameDoc } from "../services/games";
import { GAME_ACCESS_DENIED_TOAST } from "../lib/gameToasts";
import {
  clearPendingGameLink,
  hasGameLinkParam,
  isValidGameId,
  peekPendingGameLink,
  readGameLinkParam,
  stashPendingGameLink,
  withoutGameLinkParam,
} from "../lib/gameLink";

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
 *   click_action, or the service worker's openWindow). The id is read from the
 *   URL, parked (lib/gameLink), and the param is stripped with a replace
 *   navigation so a refresh or Back can't fire it again.
 * - Web, tab open, and native (Capacitor) taps: GameNotificationWatcher turns
 *   them into OPEN_GAME_EVENT, which parks the id the same way.
 *
 * A parked id is opened once the user is signed in, has a profile and the auth
 * router has left landing/auth/profile, so a signed-out tap survives sign-in.
 * The game comes from the loaded lobby list or, on a cold start where that
 * list hasn't arrived yet, from a one-off read (the same fallback the
 * notification bell uses). A game that's gone or that this account isn't in
 * lands on the lobby with the access-denied toast.
 *
 * Roll Dice links use /dice/<id> routes and only need a navigation.
 */
export function useGameDeepLink(): void {
  const { user, activeProfile } = useAuthContext();
  const { screen, setScreen } = useNavigationContext();
  const { games, openGame, activeGame } = useGameContext();
  const { notify } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();

  const [pending, setPending] = useState<string | null>(peekPendingGameLink);

  // Pick up ?game= during render (React's "adjust state when a prop changes"
  // pattern) so the open effect below sees it in the same commit.
  const [seenSearch, setSeenSearch] = useState<string | null>(null);
  if (seenSearch !== location.search) {
    setSeenSearch(location.search);
    const fromUrl = readGameLinkParam(location.search);
    if (fromUrl) setPending(fromUrl);
  }

  // Persist the id and strip the param. An invalid value is stripped too.
  useEffect(() => {
    if (!hasGameLinkParam(location.search)) return;
    const fromUrl = readGameLinkParam(location.search);
    if (fromUrl) stashPendingGameLink(fromUrl);
    else logger.warn("game_link_invalid_id");
    navigate(
      { pathname: location.pathname, search: withoutGameLinkParam(location.search), hash: location.hash },
      { replace: true, state: location.state },
    );
  }, [location.pathname, location.search, location.hash, location.state, navigate]);

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
      // message 3 s after openWindow, by which time the URL path has
      // usually opened the game; don't push a second /game entry.
      if (latest.current.activeGameId === gameId) return;
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
    if (uid === null || waiting || pending === null) return;
    let cancelled = false;
    const cached = latest.current.games.find((g) => g.id === pending);
    void (cached ? Promise.resolve(cached) : getNotificationGame(pending)).then((game) => {
      if (cancelled) return;
      clearPendingGameLink();
      setPending(null);
      if (game && canOpen(game, uid)) {
        latest.current.openGame(game);
        return;
      }
      logger.info("game_link_unavailable", { gameId: pending });
      latest.current.setScreen("lobby");
      latest.current.notify(GAME_ACCESS_DENIED_TOAST);
    });
    return () => {
      cancelled = true;
    };
  }, [uid, waiting, pending]);
}

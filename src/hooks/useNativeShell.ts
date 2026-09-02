import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { OPEN_GAME_EVENT } from "../components/GameNotificationWatcher";
import { initStatusBar, subscribeToBackButton, subscribeToDeepLinks, exitNativeApp } from "../services/nativeShell";

/**
 * Paths where the Android back button exits the app instead of popping
 * history. `/` is the landing page and `/lobby` is the signed-in home — from
 * either, "back" has nowhere sensible to go, and popping would walk the user
 * back through auth-router redirects.
 */
const ROOT_PATHS: ReadonlySet<string> = new Set(["/", "/lobby"]);

/**
 * `/game/<id>` is a deep-link-only shape: the in-app route is the stateful
 * `/game` (App.tsx renders it from GameContext.activeGame), so a link that
 * names a game id is resolved through the same OPEN_GAME_EVENT bridge push
 * notifications use. App.tsx owns the id → GameDoc lookup and the fallback
 * to the lobby when the game isn't in the loaded list.
 */
const GAME_DEEP_LINK = /^\/game\/([^/?#]+)/;

/**
 * Wires the Capacitor native shell into the SPA: status bar styling, the
 * Android hardware back button, and deep links. Renders nothing and no-ops
 * entirely on web — every service call it makes is gated on
 * `Capacitor.isNativePlatform()`.
 *
 * Must be mounted inside the router (it uses `useNavigate`) and inside the
 * tree that hosts GameNotificationWatcher, which consumes OPEN_GAME_EVENT.
 */
export function useNativeShell(): void {
  const navigate = useNavigate();
  const location = useLocation();

  // Read the live pathname from a ref so the back-button subscription is
  // attached exactly once. Re-subscribing on every navigation would race the
  // plugin's async listener removal and can drop or duplicate handlers.
  const pathnameRef = useRef(location.pathname);
  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    void initStatusBar();
  }, []);

  useEffect(() => {
    return subscribeToBackButton(({ canGoBack }) => {
      if (!canGoBack || ROOT_PATHS.has(pathnameRef.current)) {
        void exitNativeApp();
        return;
      }
      navigate(-1);
    });
  }, [navigate]);

  useEffect(() => {
    return subscribeToDeepLinks((path) => {
      const gameMatch = GAME_DEEP_LINK.exec(path);
      if (gameMatch) {
        window.dispatchEvent(
          new CustomEvent(OPEN_GAME_EVENT, { detail: { gameId: decodeURIComponent(gameMatch[1]) } }),
        );
        return;
      }
      navigate(path);
    });
  }, [navigate]);
}

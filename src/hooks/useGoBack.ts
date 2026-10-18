import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Back that never dead-ends.
 *
 * With in-app history (react-router gives the first entry the key "default")
 * this pops one entry, exactly like iOS swipe-back and the Android back
 * button, so the three never disagree. On a deep link, a push-notification
 * tap or a refresh there is nothing in-app to pop: `navigate(-1)` would leave
 * the app or do nothing, so we replace the entry with `fallback` instead.
 */
export function canGoBackInApp(locationKey: string): boolean {
  return locationKey !== "default";
}

export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (canGoBackInApp(location.key)) {
      void navigate(-1);
    } else {
      void navigate(fallback, { replace: true });
    }
  }, [navigate, location.key, fallback]);
}

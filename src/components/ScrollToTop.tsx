import { useLayoutEffect } from "react";
import { useLocation } from "react-router";

/**
 * Route changes keep the previous window scroll. Game over was opening on
 * the rematch buttons because the lobby had been scrolled. Reset the window
 * and any screen that owns its own scroller (`data-scroll-root`).
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const scrolling = document.scrollingElement;
    if (scrolling) scrolling.scrollTop = 0;
    document.querySelectorAll<HTMLElement>("[data-scroll-root]").forEach((el) => {
      el.scrollTop = 0;
    });
  }, [pathname]);
  return null;
}

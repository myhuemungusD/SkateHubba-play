import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useNavigationContext, screenToPath, type Screen } from "../context/NavigationContext";
import { useNotifications } from "../context/NotificationContext";
import { HomeIcon, MapPinIcon, UserIcon } from "./icons";

/** Screens where the persistent bottom nav is rendered. */
const NAV_VISIBLE_ON: ReadonlySet<Screen> = new Set(["lobby", "map", "record", "player"]);

interface NavItem {
  screen: Screen;
  label: string;
  Icon: (props: { size?: number; className?: string }) => ReactNode;
  /** Paths that should render this tab as active (in addition to the item's own screen). */
  matchPaths?: readonly string[];
}

// Each tab is a navigation destination with a stable URL, so render it as an
// anchor (<Link>). Using a button + imperative navigate() pushed callers
// through a handler chain where one mis-wire silently routed Map → Challenge
// on at least one build; a direct `to={path}` makes that class of bug
// impossible and also gives us native link affordances (right-click, copy
// link, screen readers announcing as "link").
const NAV_ITEMS: readonly NavItem[] = [
  { screen: "lobby", label: "Home", Icon: HomeIcon },
  { screen: "map", label: "Map", Icon: MapPinIcon },
  { screen: "record", label: "Me", Icon: UserIcon, matchPaths: ["/record", "/player"] },
];

/**
 * Persistent bottom tab bar for authenticated primary screens.
 *
 * Pattern choice: bottom tab bar vs hamburger/top — bottom navigation is
 * the dominant pattern for mobile social apps because it sits in the
 * thumb zone, supports one-handed use, and surfaces core destinations
 * without a hidden drawer. Hides itself on focus flows (game, auth).
 */
export function BottomNav() {
  const nav = useNavigationContext();
  const location = useLocation();
  // Unread state already lives in NotificationContext (the bell reads the same
  // value), so the badge is a read of shared state — no new state to lift.
  const { unreadCount } = useNotifications();

  if (!NAV_VISIBLE_ON.has(nav.screen)) return null;

  const isActive = (item: NavItem): boolean => {
    if (nav.screen === item.screen) return true;
    if (!item.matchPaths) return false;
    return item.matchPaths.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
  };

  return (
    <nav aria-label="Primary navigation" className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-safe">
      <div className="max-w-[430px] mx-auto glass rounded-2xl shadow-glass">
        <ul className="flex items-stretch justify-around px-2 py-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            const path = screenToPath(item.screen);
            // Badge only on Home, and only when the user is somewhere else —
            // the lobby header's bell already carries the count in place.
            const badgeCount = item.screen === "lobby" && !active ? unreadCount : 0;
            return (
              <li key={item.screen} className="flex-1">
                <Link
                  to={path}
                  aria-current={active ? "page" : undefined}
                  aria-label={badgeCount > 0 ? `${item.label} (${badgeCount} unread)` : item.label}
                  data-tutorial={item.screen === "record" ? "record-button" : undefined}
                  className={`group relative w-full flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
                    active
                      ? "text-brand-orange"
                      : "text-faint hover:text-white hover:bg-white/[0.03] active:scale-[0.97]"
                  }`}
                >
                  <span className="relative inline-flex">
                    <item.Icon
                      size={22}
                      className={`transition-transform duration-300 ${active ? "scale-110" : "group-hover:-translate-y-0.5"}`}
                    />
                    {badgeCount > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-brand-orange font-display text-[9px] text-white leading-none tabular-nums"
                      >
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </span>
                  <span className="font-display text-[10px] tracking-[0.15em] leading-none uppercase">
                    {item.label}
                  </span>
                  {active && (
                    <span
                      className="absolute bottom-1 h-[3px] w-8 rounded-full bg-brand-orange shadow-glow-sm"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

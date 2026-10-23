import type { ReactNode } from "react";
import { Link } from "react-router";
import { useNavigationContext, screenToPath, type Screen } from "../context/NavigationContext";
import { useNotifications } from "../context/NotificationContext";
import { CrownIcon, FilmIcon, HomeIcon, MapPinIcon, UserIcon } from "./icons";
import { HubbaIcon, type GlyphName } from "./hubbaIcons";
import { isExtrasEnabled, isHubbaIconsEnabled } from "../lib/featureFlags";

/** Screens where the persistent bottom nav is rendered. */
const NAV_VISIBLE_ON: ReadonlySet<Screen> = new Set(["lobby", "feed", "challenge", "map", "me"]);

/** True on the screens that render the fixed tab bar. */
export function isBottomNavScreen(screen: Screen): boolean {
  return NAV_VISIBLE_ON.has(screen);
}

interface NavItem {
  screen: Screen;
  label: string;
  /** Legacy icon, shown while the HubbaIcons flag is off. */
  Icon: (props: { size?: number; className?: string }) => ReactNode;
  /** HubbaIcons glyph: outline when idle, filled when this tab is active. */
  icon: GlyphName;
  /**
   * Anchor id for the onboarding tour. Two steps point at tabs now that the
   * lobby no longer carries its own challenge CTA — the tour auto-skips a
   * step whose anchor is missing, so a stale id degrades the tour silently.
   */
  tutorialId?: string;
  /**
   * Renders as the raised centre action instead of a flat tab. Reserved for
   * the single creation action in the app.
   */
  primary?: true;
  /**
   * Frozen feature tab (Clips, Map). Only rendered when
   * VITE_FEATURE_EXTRAS_ENABLED is "true" — see src/lib/featureFlags.ts.
   */
  extra?: true;
}

// Each tab is a navigation destination with a stable URL, so render it as an
// anchor (<Link>). Using a button + imperative navigate() pushed callers
// through a handler chain where one mis-wire silently routed Map → Challenge
// on at least one build; a direct `to={path}` makes that class of bug
// impossible and also gives us native link affordances (right-click, copy
// link, screen readers announcing as "link").
//
// The Me tab is active only on the "me" screen: /player/:uid is someone
// else's profile — a pushed detail screen, not a tab destination — so no tab
// claims it.
const NAV_ITEMS: readonly NavItem[] = [
  { screen: "lobby", label: "Home", Icon: HomeIcon, icon: "home" },
  { screen: "feed", label: "Clips", Icon: FilmIcon, icon: "clips", extra: true },
  {
    screen: "challenge",
    label: "Challenge",
    Icon: CrownIcon,
    icon: "challenge",
    primary: true,
    tutorialId: "challenge-cta",
  },
  { screen: "map", label: "Map", Icon: MapPinIcon, icon: "spot", extra: true },
  { screen: "me", label: "Me", Icon: UserIcon, icon: "me", tutorialId: "record-button" },
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
  // Unread state already lives in NotificationContext (the bell reads the same
  // value), so the badge is a read of shared state — no new state to lift.
  const { unreadCount } = useNotifications();

  if (!NAV_VISIBLE_ON.has(nav.screen)) return null;
  const hubbaIcons = isHubbaIconsEnabled();

  // Feature freeze: drop the Clips + Map tabs unless extras are enabled,
  // leaving Home · Challenge · Me around the raised Challenge action.
  const extrasEnabled = isExtrasEnabled();
  const items = extrasEnabled ? NAV_ITEMS : NAV_ITEMS.filter((item) => !item.extra);

  return (
    // Horizontal chrome and the tab minimums are in px, not rem: Dynamic Type
    // scales the root font, and at 320px with the largest text rem padding
    // alone ate the room the five 44pt targets need. 44 is a pt floor, so it
    // must not grow with the text either.
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-40 px-[12px] min-[360px]:px-[16px] pb-safe"
    >
      <div className="max-w-[430px] mx-auto glass rounded-2xl shadow-glass">
        <ul className="flex items-stretch justify-around px-[4px] min-[360px]:px-[8px] py-2">
          {items.map((item) => {
            const active = nav.screen === item.screen;
            const path = screenToPath(item.screen);
            // Badge only on Home, and only when the user is somewhere else —
            // the lobby header's bell already carries the count in place.
            const badgeCount = item.screen === "lobby" && !active ? unreadCount : 0;
            return (
              <li key={item.screen} className="min-w-[44px] flex-1">
                <Link
                  to={path}
                  aria-current={active ? "page" : undefined}
                  aria-label={badgeCount > 0 ? `${item.label} (${badgeCount} unread)` : item.label}
                  data-tutorial={item.tutorialId}
                  className={`hb-press group relative w-full min-w-[44px] min-h-[44px] flex flex-col items-center justify-center gap-1 px-0.5 py-2 rounded-xl transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
                    active
                      ? "text-brand-orange"
                      : "text-faint hover:text-white hover:bg-white/[0.03] active:scale-[0.97]"
                  }`}
                >
                  <span
                    className={
                      item.primary
                        ? // Raised filled disc: Challenge is the only creation
                          // action in the app, so it carries the visual weight
                          // of a FAB while staying a plain tab <Link>.
                          "relative inline-flex items-center justify-center -mt-5 w-[44px] h-[44px] rounded-full bg-brand-orange text-on-brand shadow-glow-sm ring-4 ring-background/80"
                        : "relative inline-flex"
                    }
                  >
                    {hubbaIcons ? (
                      <HubbaIcon
                        name={item.icon}
                        // The raised Challenge disc is always solid, so its
                        // crown always uses the filled form for contrast.
                        active={active || item.primary === true}
                        size={item.primary ? 24 : 22}
                      />
                    ) : (
                      <item.Icon
                        size={22}
                        className={`transition-transform duration-300 ${active ? "scale-110" : "group-hover:-translate-y-0.5"}`}
                      />
                    )}
                    {badgeCount > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 -right-2 min-w-[1.3em] h-[1.3em] px-[0.3em] flex items-center justify-center rounded-full bg-brand-orange font-display text-sm text-on-brand leading-none tabular-nums"
                      >
                        {badgeCount > 9 ? "9+" : badgeCount}
                      </span>
                    )}
                  </span>
                  {/* Tracking is tighter than the 0.15em used elsewhere so the
                      14px labels (incl. "Challenge") fit five tabs of about
                      53–68px at a 320px viewport (measured, extras on). At
                      large Dynamic Type the label truncates rather than
                      squeezing a neighbour below 44pt; aria-label keeps the
                      full name. */}
                  <span className="max-w-full truncate font-display text-sm tracking-[0.05em] leading-none uppercase">
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

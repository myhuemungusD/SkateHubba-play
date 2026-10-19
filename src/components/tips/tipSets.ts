/**
 * Hesher's per-screen tips. Each set shows once per user the first time they
 * land on that screen (or open that sheet), 1-3 bubbles long. Copy matches
 * the onboarding tour: lowercase, short, chill.
 *
 * `anchor` names a `data-tutorial` hook; when it's on screen Hesher rings it.
 * `requiresAnchor` drops the bubble when the hook isn't there (for example
 * the clip Edit tip when you have no pinned clips yet).
 */

export interface Tip {
  title: string;
  body: string;
  anchor?: string;
  requiresAnchor?: boolean;
}

export interface TipSet {
  id: string;
  /** "top" keeps the bubble clear of game controls at the bottom. */
  placement?: "top" | "bottom";
  tips: readonly Tip[];
}

export const TIP_SETS: Record<string, TipSet> = {
  lobby: {
    id: "lobby",
    tips: [
      { title: "home base", body: "your games stack up here. tap one to jump back in." },
      { title: "start a game", body: "challenge a friend or hop in quickplay.", anchor: "challenge-cta" },
      {
        title: "roll dice",
        body: "street dice with the crew. just for fun.",
        anchor: "dice-card",
        requiresAnchor: true,
      },
    ],
  },
  feed: {
    id: "feed",
    tips: [
      { title: "clips", body: "swipe for the next clip. props go to the ones that rip." },
      {
        title: "post one",
        body: "the camera films a clip and posts it here.",
        anchor: "feed-camera",
        requiresAnchor: true,
      },
    ],
  },
  me: {
    id: "me",
    tips: [
      { title: "your page", body: "stats, badges and your pinned clips live here." },
      {
        title: "fix a clip",
        body: "tap the scissors on your own clip to trim it. your original stays.",
        anchor: "clip-edit",
        requiresAnchor: true,
      },
      {
        title: "spot passport",
        body: "every check-in stamps it. legendary spots earn badges.",
        anchor: "spot-passport",
        requiresAnchor: true,
      },
    ],
  },
  map: {
    id: "map",
    tips: [
      { title: "the map", body: "skate spots around you. tap a pin to peep it." },
      { title: "check in", body: "pull up to a spot and check in for xp and a passport stamp." },
      { title: "add a spot", body: "found something new? drop it here.", anchor: "map-add-spot", requiresAnchor: true },
    ],
  },
  addspot: {
    id: "addspot",
    placement: "top",
    tips: [
      { title: "add a spot", body: "use your location or type it in. photos help heads find it." },
      { title: "keep it lowkey", body: "secret spot? set it to crew-only or private." },
    ],
  },
  spotdetail: {
    id: "spotdetail",
    tips: [
      { title: "spot page", body: "photos, gnar rating and bust risk, all in one spot." },
      {
        title: "check in",
        body: "you've gotta be there to check in. stamps your passport.",
        anchor: "spot-checkin",
        requiresAnchor: true,
      },
    ],
  },
  studio: {
    id: "studio",
    tips: [
      { title: "closet studio", body: "design your own gear. pick a template, then paint." },
      {
        title: "tools",
        body: "your tools live here. layers keep it tidy.",
        anchor: "studio-tools",
        requiresAnchor: true,
      },
    ],
  },
  shoe360: {
    id: "shoe360",
    placement: "top",
    tips: [{ title: "spin it", body: "drag the shoe to turn it all the way around." }],
  },
  dice: {
    id: "dice",
    tips: [
      { title: "roll dice", body: "start a table, bring the crew, take turns rolling." },
      { title: "just for fun", body: "wins and losses only. nothing to buy, nothing to cash out." },
    ],
  },
  runner: {
    id: "runner",
    placement: "top",
    tips: [{ title: "skate runner", body: "tap to pop over stuff. see how far you can push." }],
  },
  pro: {
    id: "pro",
    tips: [{ title: "pro tools", body: "your pro stuff lives here: calls, challenges and featured clips." }],
  },
  settings: {
    id: "settings",
    tips: [
      {
        title: "tips",
        body: "over these bubbles? switch tips off here, or replay them anytime.",
        anchor: "tips-settings",
      },
    ],
  },
  game: {
    id: "game",
    placement: "top",
    tips: [
      { title: "how s.k.a.t.e. works", body: "the setter lands a trick. match it or take a letter." },
      { title: "five letters", body: "spell s.k.a.t.e. and you're out. last one standing wins." },
      { title: "your turn", body: "when it's on you, film it. i'll stay out of the way." },
    ],
  },
};

const ROUTES: ReadonlyArray<[(p: string) => boolean, string]> = [
  [(p) => p === "/lobby", "lobby"],
  [(p) => p === "/feed", "feed"],
  [(p) => p === "/me", "me"],
  [(p) => p === "/map", "map"],
  [(p) => p.startsWith("/spots/"), "spotdetail"],
  [(p) => p === "/closet/studio", "studio"],
  [(p) => p === "/dice" || p.startsWith("/dice/"), "dice"],
  [(p) => p === "/play/runner", "runner"],
  [(p) => p === "/pro", "pro"],
  [(p) => p === "/settings", "settings"],
  [(p) => p === "/game", "game"],
];

/** Tip set for a URL path, or null when that screen has none. */
export function tipSetForPath(pathname: string): TipSet | null {
  const hit = ROUTES.find(([match]) => match(pathname));
  return hit ? TIP_SETS[hit[1]] : null;
}

/** Bubbles to show: anchor-dependent ones drop out when their hook is absent. */
export function visibleTips(set: TipSet, root: ParentNode = document): Tip[] {
  return set.tips.filter((t) => !t.requiresAnchor || !!root.querySelector(anchorSelector(t.anchor ?? "")));
}

export function anchorSelector(anchor: string): string {
  return `[data-tutorial="${anchor}"]`;
}

/**
 * Pure data for the App Store / Play review kit (no I/O, unit-tested).
 * seed.mjs writes buildSeedDocs(); screenshots.mjs walks SIZES × SCREENS.
 */

/** Store screenshot sizes (portrait pixels) and the CSS viewport that yields them. */
export const SIZES = [
  { id: "ios-6.9", store: "App Store", label: 'iPhone 6.9"', width: 440, height: 956, scale: 3, mobile: true }, // 1320×2868
  { id: "ios-6.3", store: "App Store", label: 'iPhone 6.3"', width: 402, height: 874, scale: 3, mobile: true }, // 1206×2622
  { id: "ios-6.5", store: "App Store", label: 'iPhone 6.5"', width: 428, height: 926, scale: 3, mobile: true }, // 1284×2778
  { id: "ios-5.5", store: "App Store", label: 'iPhone 5.5"', width: 414, height: 736, scale: 3, mobile: true }, // 1242×2208
  { id: "play-phone", store: "Google Play", label: "Phone", width: 360, height: 640, scale: 3, mobile: true }, // 1080×1920
  { id: "play-7in", store: "Google Play", label: '7" tablet', width: 600, height: 960, scale: 2, mobile: true }, // 1200×1920
  { id: "play-10in", store: "Google Play", label: '10" tablet', width: 800, height: 1280, scale: 2, mobile: true }, // 1600×2560
];

/**
 * Key screens, in store order. Each one backs a promise in the iOS listing
 * (one-take game, your record, head-to-head, spot passport, turns on a clock)
 * and shows only what the iPhone launch build ships. `open` names how
 * screenshots.mjs reaches a screen that has no URL of its own (the game screen
 * opens from its lobby card). `click` taps a text before the shot (Home expands
 * its "waiting on them" games), and `scrollTo` scrolls an element to the top,
 * past the header. `optional` shots are skipped with --skip-optional.
 */
export const SCREENS = [
  { id: "01-game", path: "/lobby", open: "game" },
  { id: "02-record", path: "/me", scrollTo: '[data-testid="brag-row"]' },
  { id: "03-vs-you", path: "/player/review-demo-opp-1", scrollTo: '[data-testid="vs-you-row"]' },
  { id: "04-passport", path: "/me", scrollTo: '[data-testid="spot-passport"]' },
  { id: "05-lobby", path: "/lobby", click: "waiting on them", scrollTo: "#turn-stack-heading" },
  { id: "06-clock", path: "/challenge?to=kickflip_kai", optional: true },
];

/**
 * Routes that must never appear in a store screenshot set: screens the iPhone
 * build hides (Roll Dice, Skate Runner) and screens the listing doesn't promise
 * (map, feed, Closet, trading).
 */
export const FORBIDDEN_PATHS = ["/dice", "/play/runner", "/map", "/feed", "/closet", "/trading"];

/** Text that means a shot caught an error, an empty state or an unpromised feature. */
// "put (you|someone) on" / "put on by" are the post-#812 wording for a pro blessing.
export const FORBIDDEN_TEXT =
  /temporarily unavailable|No video recorded|Something went wrong|Roll Dice|Skate Runner|\bbless|put (you|someone) on|put on by/i;

/** Anything open on top of the screen: dialogs, sheets and toasts. */
export const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-testid="toast"]';

export const pixelSize = (s) => ({ w: s.width * s.scale, h: s.height * s.scale });
export const shotPath = (dir, size, screen) => `${dir}/${size.id}/${screen.id}.png`;

/** Seeded demo skaters. Made-up handles only, never a real user's. */
export const DEMO_OPPONENTS = [
  { uid: "review-demo-opp-1", username: "kickflip_kai", stance: "Regular" },
  { uid: "review-demo-opp-2", username: "manny_mae", stance: "Goofy" },
  { uid: "review-demo-opp-3", username: "ledge_leo", stance: "Regular" },
  { uid: "review-demo-opp-4", username: "nollie_nia", stance: "Goofy" },
  { uid: "review-demo-opp-5", username: "tre_flip_tess", stance: "Regular" },
  { uid: "review-demo-opp-6", username: "grind_gabe", stance: "Goofy" },
];

/**
 * Server-written stats for the opponent the screenshots open (kai), so his
 * profile above VS YOU isn't all zeros. Oldest result first; his last game is
 * the loss to the reviewer, so his current streak is 0.
 */
export const DEMO_OPPONENT_STATS = {
  "review-demo-opp-1": {
    wins: 22,
    losses: 9,
    gamesPlayed: 31,
    currentWinStreak: 0,
    bestWinStreak: 6,
    tricksLanded: 96,
    tricksFailed: 41,
    lettersGiven: 137,
    lettersTaken: 89,
    recentResults: ["W", "W", "L", "W", "W", "W", "L", "W", "W", "L"],
  },
};

/** Mike White Signature shoes the demo profile owns (credited in-app by DesignerCredit). */
export const DEMO_LOCKER = [
  { id: "review-demo-gear-1", itemDefId: "mike_white_signature_001", type: "shoes", rarity: "limited", equipped: true },
  { id: "review-demo-gear-2", itemDefId: "mike_white_og_gum", type: "shoes", rarity: "limited", equipped: false },
  { id: "review-demo-gear-3", itemDefId: "mike_white_ice_bolt", type: "shoes", rarity: "limited", equipped: false },
  { id: "review-demo-gear-4", itemDefId: "mike_white_creamsicle", type: "shoes", rarity: "limited", equipped: false },
];

/** Display names for the Mike White shoes in {@link DEMO_LOCKER}. */
export const MIKE_WHITE_NAMES = {
  mike_white_signature_001: "Mike White Signature — Tan / White / Navy",
  mike_white_og_gum: "OG Signature — Black / Gum",
  mike_white_ice_bolt: "Bolt Runner — Black / Ice",
  mike_white_creamsicle: "Creamsicle — White / Orange",
};

/** Read the review account settings from env. Never defaulted, never logged. */
export function reviewEnv(env) {
  const email = env.REVIEW_EMAIL?.trim();
  const password = env.REVIEW_PASSWORD ?? "";
  const missing = [];
  if (!email) missing.push("REVIEW_EMAIL");
  if (password.length < 10) missing.push("REVIEW_PASSWORD (10+ characters)");
  const username = env.REVIEW_USERNAME?.trim().toLowerCase() ?? "";
  if (!username) missing.push("REVIEW_USERNAME");
  return {
    email,
    password,
    username,
    appUrl: (env.REVIEW_BASE_URL || "https://skatehubba.com").replace(/\/$/, ""),
    missing,
  };
}

/**
 * Every Firestore doc the reviewer account needs, as [path, data].
 * Deterministic ids, so a re-run refreshes instead of duplicating.
 * Only public features: the reviewer is NOT added to config/featureTesters,
 * so App Review sees exactly what ships.
 */
/** Where the seed uploads the demo clip in Storage. */
export const DEMO_VIDEO_PATH = "review-kit/sh-video-edit.mp4";

/**
 * Firebase Storage download URL. The game screen only plays trick videos from
 * firebasestorage.googleapis.com, so a clip hosted anywhere else shows
 * "No video recorded".
 */
export function storageDownloadUrl(bucket, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

export function buildSeedDocs({
  uid,
  username,
  appUrl,
  now = new Date(),
  tutorialVersion = 2,
  tipsDisabled = false,
  videoUrl,
  includeEmulatorOnly = true,
}) {
  const day = 24 * 60 * 60 * 1000;
  const at = (offsetDays) => new Date(now.getTime() + offsetDays * day);
  const video = videoUrl || `${appUrl}/sh-video-edit.mp4`;
  const docs = [];
  const put = (path, data) => docs.push([path, data]);

  put(`users/${uid}`, {
    uid,
    username,
    stance: "Regular",
    createdAt: at(-30),
    isReviewAccount: true,
    // Server-written stats, seeded so the profile shows a played-in account.
    wins: 14,
    losses: 6,
    gamesPlayed: 20,
    currentWinStreak: 2,
    bestWinStreak: 5,
    tricksLanded: 61,
    tricksFailed: 23,
    // 14 wins × 5 given + ~3 a loss; 6 losses × 5 taken + ~2 a win.
    lettersGiven: 88,
    lettersTaken: 58,
    xp: 2460,
    level: 11,
    // Oldest first. Ends L, L, W, W to match the four finished games below.
    recentResults: ["W", "W", "L", "W", "W", "W", "L", "L", "W", "W"],
  });
  put(`usernames/${username}`, { uid });
  put(`users/${uid}/private/profile`, {
    dob: "1995-06-15",
    onboardingTutorialVersion: tutorialVersion,
    onboardingCompletedAt: at(-30),
    onboardingSkippedAt: null,
    // Screenshot runs turn the tip bubbles off so they don't cover the screen.
    ...(tipsDisabled ? { tipsDisabled: true } : {}),
  });
  for (const o of DEMO_OPPONENTS) {
    put(`users/${o.uid}`, {
      uid: o.uid,
      username: o.username,
      stance: o.stance,
      createdAt: at(-60),
      ...(DEMO_OPPONENT_STATS[o.uid] ?? {}),
    });
    put(`usernames/${o.username}`, { uid: o.uid });
  }

  const [a, b, c, d, e, f] = DEMO_OPPONENTS;
  const base = (id, opp, extra) =>
    put(`games/${id}`, {
      player1Uid: uid,
      player2Uid: opp.uid,
      player1Username: username,
      player2Username: opp.username,
      p1Letters: 0,
      p2Letters: 0,
      status: "active",
      phase: "setting",
      currentTurn: uid,
      currentSetter: uid,
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
      turnDeadline: at(1),
      turnNumber: 1,
      winner: null,
      createdAt: at(-1),
      updatedAt: at(-1),
      ...extra,
    });
  // Mid-game: kai set a kickflip and it's the reviewer's turn to match it.
  base("review-demo-your-turn", a, {
    p1Letters: 1,
    p2Letters: 2,
    turnNumber: 6,
    phase: "matching",
    currentSetter: a.uid,
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: video,
  });
  base("review-demo-their-turn", b, { currentTurn: b.uid, currentSetter: b.uid, turnNumber: 3, p2Letters: 1 });
  base("review-demo-your-set", c, { p1Letters: 2, p2Letters: 3, turnNumber: 9 });
  base("review-demo-won", a, {
    status: "complete",
    winner: uid,
    p2Letters: 5,
    p1Letters: 3,
    turnNumber: 14,
    updatedAt: at(-2),
  });
  // Extra games so Home is full: two more on the reviewer, one more waiting,
  // and a finished win and loss.
  base("review-demo-your-turn-2", e, {
    p1Letters: 0,
    p2Letters: 1,
    turnNumber: 4,
    phase: "matching",
    currentSetter: e.uid,
    currentTrickName: "Tre Flip",
    currentTrickVideoUrl: video,
    turnDeadline: at(2.5),
  });
  base("review-demo-your-set-2", f, { p1Letters: 1, p2Letters: 1, turnNumber: 5, turnDeadline: at(6) });
  base("review-demo-their-turn-2", d, { currentTurn: d.uid, currentSetter: d.uid, turnNumber: 2 });
  base("review-demo-won-2", f, {
    status: "complete",
    winner: uid,
    p2Letters: 5,
    p1Letters: 2,
    turnNumber: 11,
    updatedAt: at(-4),
  });
  // Kai won the earlier game, so head-to-head reads 1–1 over two games.
  base("review-demo-lost-kai", a, {
    status: "complete",
    winner: a.uid,
    p1Letters: 5,
    p2Letters: 3,
    turnNumber: 15,
    updatedAt: at(-8),
  });
  base("review-demo-lost", e, {
    status: "complete",
    winner: e.uid,
    p1Letters: 5,
    p2Letters: 4,
    turnNumber: 16,
    updatedAt: at(-6),
  });

  const clip = (gameId, turn, role, who, trick, upvotes) =>
    put(`clips/${gameId}_${turn}_${role}`, {
      gameId,
      turnNumber: turn,
      role,
      playerUid: who.uid,
      playerUsername: who.username,
      trickName: trick,
      videoUrl: video,
      spotId: null,
      createdAt: at(-2),
      moderationStatus: "active",
      upvoteCount: upvotes,
    });
  const me = { uid, username };
  clip("review-demo-won", 1, "set", me, "Kickflip", 12);
  clip("review-demo-won", 1, "match", a, "Kickflip", 7);
  clip("review-demo-won", 2, "set", a, "Heelflip", 9);
  clip("review-demo-won", 3, "set", me, "Frontside 180", 15);
  clip("review-demo-won", 4, "set", a, "Varial Flip", 21);
  clip("review-demo-your-set", 2, "set", c, "Backside Boardslide", 18);
  clip("review-demo-your-set", 3, "set", d, "Nollie Heelflip", 11);
  clip("review-demo-your-set", 4, "match", me, "Pop Shove-it", 8);

  for (const g of DEMO_LOCKER) {
    const { id, ...item } = g;
    put(`users/${uid}/locker/${id}`, {
      ...item,
      brand: "Mike White",
      name: MIKE_WHITE_NAMES[item.itemDefId],
      imageUrl: `${appUrl}/assets/closet/mike-white/card/${item.itemDefId.replace(/^mike_white_/, "").replace(/_/g, "-")}.webp`,
      acquiredAt: at(-5),
      provenance: { reason: "demo" },
    });
  }

  // Badges that match the seeded stats, so the ribbon isn't all locked.
  const badges = [
    ["games_10", -20],
    ["wins_10", -12],
    ["streak_3", -9],
    ["streak_5", -4],
    ["lands_50", -6],
    ["clips_1", -25],
  ];
  for (const [id, when] of badges) put(`users/${uid}/achievements/${id}`, { earnedAt: at(when), reason: "demo" });

  // Spot passport stamps (public), so the profile shows check-ins.
  const stamps = [
    ["review-demo-spot-1", "Cupertino Ledges", 4, -8],
    ["review-demo-spot-3", "De Anza Hubba", 2, -5],
    ["review-demo-spot-6", "Wolfe Rd Bank", 1, -2],
  ];
  for (const [spotId, spotName, count, when] of stamps) {
    put(`users/${uid}/passport/${spotId}`, {
      spotId,
      spotName,
      scope: "public",
      legendary: false,
      count,
      firstAt: at(when),
    });
  }
  put(`passportSettings/${uid}`, { public: true });

  // Six spots near Apple Park so the map has nearby pins during review.
  const spot = (id, name, lat, lng, obstacles) =>
    put(`spots/${id}`, {
      createdBy: uid,
      name,
      description: "Demo spot for App Review.",
      latitude: lat,
      longitude: lng,
      gnarRating: 2,
      bustRisk: 1,
      obstacles,
      photoUrls: [],
      isVerified: false,
      isActive: true,
      createdAt: at(-10),
      updatedAt: at(-10),
    });
  spot("review-demo-spot-1", "Cupertino Ledges", 37.3349, -122.009, ["ledge", "stairs"]);
  spot("review-demo-spot-2", "Memorial Park Manual Pad", 37.3233, -122.0447, ["manual pad"]);
  spot("review-demo-spot-3", "De Anza Hubba", 37.3195, -122.0451, ["hubba", "stairs"]);
  spot("review-demo-spot-4", "Stevens Creek Gap", 37.3237, -122.0322, ["gap"]);
  spot("review-demo-spot-5", "Infinite Loop Curbs", 37.3318, -122.0312, ["curb", "ledge"]);
  spot("review-demo-spot-6", "Wolfe Rd Bank", 37.3301, -122.0146, ["bank"]);
  return includeEmulatorOnly ? docs : docs.filter(([path]) => !isEmulatorOnlyPath(path, uid));
}

/**
 * Docs only the emulator seed writes. Feed clips, map spots and passport
 * stamps would be seen by every real user, so production leaves them out.
 * Closet items are left out too, because the Closet is off in the store
 * build and the review notes say so. The emulator keeps all of them for
 * screenshots.
 */
export function isEmulatorOnlyPath(path, uid) {
  return (
    path.startsWith("clips/") ||
    path.startsWith("spots/") ||
    path.startsWith(`users/${uid}/passport/`) ||
    path.startsWith(`users/${uid}/locker/`)
  );
}

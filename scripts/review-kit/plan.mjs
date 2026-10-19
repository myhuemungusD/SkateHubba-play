/**
 * Pure data for the App Store / Play review kit (no I/O, unit-tested).
 * seed.mjs writes buildSeedDocs(); screenshots.mjs walks SIZES × SCREENS.
 */

/** Store screenshot sizes (portrait pixels) and the CSS viewport that yields them. */
export const SIZES = [
  { id: "ios-6.9", store: "App Store", label: 'iPhone 6.9"', width: 440, height: 956, scale: 3, mobile: true }, // 1320×2868
  { id: "ios-6.5", store: "App Store", label: 'iPhone 6.5"', width: 428, height: 926, scale: 3, mobile: true }, // 1284×2778
  { id: "ios-5.5", store: "App Store", label: 'iPhone 5.5"', width: 414, height: 736, scale: 3, mobile: true }, // 1242×2208
  { id: "ipad-13", store: "App Store", label: 'iPad 13"', width: 1032, height: 1376, scale: 2, mobile: true }, // 2064×2752 (TARGETED_DEVICE_FAMILY 1,2)
  { id: "play-phone", store: "Google Play", label: "Phone", width: 360, height: 640, scale: 3, mobile: true }, // 1080×1920
  { id: "play-7in", store: "Google Play", label: '7" tablet', width: 600, height: 960, scale: 2, mobile: true }, // 1200×1920
  { id: "play-10in", store: "Google Play", label: '10" tablet', width: 800, height: 1280, scale: 2, mobile: true }, // 1600×2560
];

/** Key screens, in store order. */
export const SCREENS = [
  { id: "01-lobby", path: "/lobby" },
  { id: "02-feed", path: "/feed" },
  { id: "03-map", path: "/map" },
  { id: "04-profile", path: "/profile" },
  { id: "05-settings", path: "/settings" },
];

export const pixelSize = (s) => ({ w: s.width * s.scale, h: s.height * s.scale });
export const shotPath = (dir, size, screen) => `${dir}/${size.id}/${screen.id}.png`;

export const DEMO_OPPONENTS = [
  { uid: "review-demo-opp-1", username: "kickflip_kai", stance: "Regular" },
  { uid: "review-demo-opp-2", username: "manny_mae", stance: "Goofy" },
];

/** Read the review account settings from env. Never defaulted, never logged. */
export function reviewEnv(env) {
  const email = env.REVIEW_EMAIL?.trim();
  const password = env.REVIEW_PASSWORD ?? "";
  const missing = [];
  if (!email) missing.push("REVIEW_EMAIL");
  if (password.length < 10) missing.push("REVIEW_PASSWORD (10+ characters)");
  return {
    email,
    password,
    username: (env.REVIEW_USERNAME || "appreview").toLowerCase(),
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
export function buildSeedDocs({ uid, username, appUrl, now = new Date(), tutorialVersion = 2 }) {
  const day = 24 * 60 * 60 * 1000;
  const at = (offsetDays) => new Date(now.getTime() + offsetDays * day);
  const video = `${appUrl}/sh-video-edit.mp4`;
  const docs = [];
  const put = (path, data) => docs.push([path, data]);

  put(`users/${uid}`, { uid, username, stance: "Regular", createdAt: at(-30), isReviewAccount: true });
  put(`usernames/${username}`, { uid });
  put(`users/${uid}/private/profile`, {
    dob: "1995-06-15",
    onboardingTutorialVersion: tutorialVersion,
    onboardingCompletedAt: at(-30),
    onboardingSkippedAt: null,
  });
  for (const o of DEMO_OPPONENTS) {
    put(`users/${o.uid}`, { uid: o.uid, username: o.username, stance: o.stance, createdAt: at(-60) });
    put(`usernames/${o.username}`, { uid: o.uid });
  }

  const [a, b] = DEMO_OPPONENTS;
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
  base("review-demo-your-turn", a, { p1Letters: 1, p2Letters: 2, turnNumber: 6 });
  base("review-demo-their-turn", b, { currentTurn: b.uid, currentSetter: b.uid, turnNumber: 3, p2Letters: 1 });
  base("review-demo-won", a, {
    status: "complete",
    winner: uid,
    p2Letters: 5,
    p1Letters: 3,
    turnNumber: 14,
    updatedAt: at(-2),
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

  // Two spots near Apple Park so the map has nearby pins during review.
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
  return docs;
}

/**
 * Seed data for the account-deletion coverage tests: one sample per collection
 * the erasure registry deletes or anonymizes, plus the retained ones. Shared
 * so an emulator run can seed exactly what the unit test seeds.
 *
 * Not production code; excluded from coverage by the `*test-helpers*` pattern.
 */
import type { Seed } from "./account-delete.test-helpers";

export const UID = "u1";
export const OTHER = "u2";

/**
 * Sample docs for every "delete" and "anonymize" collection, each owned by or
 * naming UID. The keys must match the registry exactly, so classifying a new
 * collection as deleted also forces a sample here.
 */
export const SAMPLES: Record<string, Seed> = {
  users: { users: { [UID]: { username: "tonyh" }, [OTHER]: { username: "rival" } } },
  "users/{}/private": { "users/u1/private": { profile: { email: "t@example.com" }, wtt: { streak: 3 } } },
  "users/{}/achievements": { "users/u1/achievements": { a: {} } },
  "users/{}/blocked_users": { "users/u1/blocked_users": { u3: {} } },
  "users/{}/xpMarkers": { "users/u1/xpMarkers": { m: {} } },
  "users/{}/passport": { "users/u1/passport": { s1: { scope: "public" } } },
  "users/{}/checkins": { "users/u1/checkins": { c1: { spotId: "s1" } } },
  "users/{}/profileCustom": { "users/u1/profileCustom": { main: { bio: "hi" } } },
  usernames: { usernames: { tonyh: { uid: UID } } },
  "users/{}/locker": { "users/u1/locker": { deck_1: { lockedByTrade: "tHeld" } } },
  "users/{}/wallet": { "users/u1/wallet": { main: { balance: 50 } } },
  "users/{}/ledger": { "users/u1/ledger": { tx1: { amount: 50 } } },
  "users/{}/closetLimits": { "users/u1/closetLimits": { daily: { offers: 1 } } },
  "users/{}/closetDesigns": { "users/u1/closetDesigns": { d0: { shared: true } } },
  trades: {
    trades: {
      tDone: { fromUid: UID, toUid: OTHER, parties: [UID, OTHER], status: "completed", note: "deal?" },
      tHeld: {
        fromUid: OTHER,
        toUid: UID,
        parties: [OTHER, UID],
        status: "held",
        give: [{ copyId: "wheels_1" }],
        get: [{ copyId: "deck_1" }],
        secondFactor: { [UID]: false, [OTHER]: true },
      },
    },
    "users/u2/locker": { wheels_1: { lockedByTrade: "tHeld" } },
  },
  serials: {
    serials: {
      deck_7: { ownerUid: UID, history: [{ uid: OTHER }, { uid: UID }] },
      // Owned by someone else after a trade; history still names this account.
      wheels_3: {
        ownerUid: OTHER,
        history: [
          { uid: UID, at: 1, reason: "mint" },
          { uid: OTHER, at: 2, reason: "trade", tradeId: "tDone" },
        ],
      },
    },
  },
  "drops/{}/claims": { drops: { w42: { name: "week 42" } }, "drops/w42/claims": { [UID]: {}, [OTHER]: {} } },
  "drops/{}/entries": { "drops/w42/entries": { [UID]: {} } },
  games: { games: { gDone: { player1Uid: UID, player2Uid: OTHER, status: "completed" } } },
  diceGames: {
    diceGames: {
      dDone: {
        playerUids: [UID, OTHER],
        player1Uid: UID,
        player2Uid: OTHER,
        player1Username: "tonyh",
        player2Username: "rival",
        status: "complete",
        winner: UID,
        scores: { [UID]: 3, [OTHER]: 1 },
        history: [{ uid: UID, dice: [4, 5, 6] }],
      },
    },
  },
  diceStats: { diceStats: { [UID]: { wins: 1 } } },
  diceCreateLimits: { diceCreateLimits: { [UID]: { lastCreateAt: 1 } } },
  nudges: { nudges: { n1: { senderUid: UID, recipientUid: OTHER } } },
  nudge_limits: { nudge_limits: { u1_g1: { senderUid: UID } } },
  clips: { clips: { c1: { playerUid: UID } } },
  "clips/{}/comments": {
    clips: { theirClip: { playerUid: OTHER } },
    "clips/theirClip/comments": { k1: { userId: UID } },
  },
  clipVotes: { clipVotes: { v1: { uid: UID, clipId: "theirClip" } } },
  disputes: { disputes: { x1: { setterUid: UID } } },
  disputeVotes: { disputeVotes: { v1: { uid: UID, disputeId: "nope", verdict: "land" } } },
  trainingLabels: { trainingLabels: { l1: { ownerUid: UID } } },
  trainingRevocations: { trainingRevocations: { [UID]: { revokedAt: 1 } } },
  wttVotes: { wttVotes: { theirClip_u1: { uid: UID, clipId: "theirClip" } } },
  spots: { spots: { sMine: { createdBy: UID, name: "Hubba", checkinCount: 9 } } },
  "spots/{}/comments": { "spots/sMine/comments": { k1: { userId: UID, content: "sick" } } },
  "spots/{}/messages": { "spots/sMine/messages": { m1: { userId: UID, content: "who's here" } } },
  privateSpots: {
    privateSpots: {
      pMine: { createdBy: UID, crewUids: [] },
      pCrew: { createdBy: OTHER, crewUids: [UID, "u3"] },
    },
  },
  spotMessageReports: { spotMessageReports: { r1: { reportedBy: UID } } },
  "spotPresence/{}/here": { "spotPresence/sMine/here": { [UID]: { uid: UID, username: "tonyh" } } },
  mapState: { mapState: { [UID]: { lastFix: [1, 2] } } },
  passportSettings: { passportSettings: { [UID]: { public: true } } },
  skaterActivity: { skaterActivity: { [UID]: { uid: UID, visible: true } } },
  onlineStatus: { onlineStatus: { [UID]: { hidden: false } } },
  notifications: { notifications: { n1: { recipientUid: UID }, n2: { senderUid: UID, recipientUid: OTHER } } },
  notification_limits: { notification_limits: { l1: { senderUid: UID } } },
  pushTargets: { pushTargets: { [UID]: { tokens: ["t"] } } },
  push_dispatch: { push_dispatch: { p1: { recipientUid: UID } } },
  push_dispatch_limits: { push_dispatch_limits: { l1: { senderUid: UID } } },
  reports: { reports: { r1: { reporterUid: UID, reportedUid: OTHER } } },
  reports_limits: { reports_limits: { u1_u2: { reporterUid: UID } } },
  moderationStatements: { moderationStatements: { s1: { subjectUid: UID } } },
  appeals: { appeals: { a1: { appellantUid: UID } } },
  proReviews: { proReviews: { c_u1: { uid: UID } } },
  proChallenges: { proChallenges: { ch1: { proUid: UID } } },
  proChallengeEntries: { proChallengeEntries: { ch9_u1: { uid: UID } } },
  proProps: { proProps: { p1: { fromUid: UID, toUid: OTHER }, p2: { fromUid: OTHER, toUid: UID } } },
  proFeatured: { proFeatured: { theirClip: { proUid: UID } } },
};

/** Retained collections seeded too, to prove they are left alone. */
export const RETAINED_SAMPLES: Seed = {
  bans: { [UID]: { reason: "spam" } },
  closetAudit: { a1: { targetUid: UID } },
  adminAudit: { a1: { targetId: UID } },
  xpPairs: { u1_u2: { utcDay: 1, count: 2 } },
  proGold: { theirClip: { uid: UID } },
  proBlessings: { b1: { blesserUid: OTHER, targetUid: UID } },
};

/** Storage objects: everything owned by UID goes, OTHER's stay. */
export const MEDIA = [
  "games/gDone/round1.webm",
  "users/u1/avatar.webp",
  "users/u1/banner.webp",
  "closetDesigns/u1/d0.png",
  "userClips/u1/c1.mp4",
  "approvedClips/u1/c1.mp4",
  "users/u2/avatar.webp",
  "approvedClips/u2/c9.mp4",
];

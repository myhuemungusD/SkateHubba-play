/**
 * What account erasure does with every Firestore collection and Storage folder.
 *
 * This is the checklist behind Apple 5.1.1(v) and our privacy answers: when a
 * skater deletes their account, every place their data can live is listed
 * here with what happens to it. `account-delete.coverage.test.ts` parses
 * firestore.rules and storage.rules and fails when a collection or folder is
 * missing from this list, so a new feature cannot quietly add user data that
 * deletion never reaches. It also seeds a doc in every "delete" and
 * "anonymize" collection and proves the cascade leaves nothing pointing at
 * the uid.
 *
 * Paths use `{}` for any id segment, e.g. `users/{}/wallet`.
 *
 *   delete     this account's docs are removed
 *   anonymize  shared with another skater; kept for them with this account
 *              replaced by a tombstone (see `_anonymize.ts`)
 *   retain     kept on purpose; `why` says why
 *   none       holds no per-user data
 */

export type ErasureAction = "delete" | "anonymize" | "retain" | "none";

export interface ErasureEntry {
  action: ErasureAction;
  why: string;
}

export const FIRESTORE_ERASURE: Readonly<Record<string, ErasureEntry>> = {
  // ── Identity ──
  users: { action: "delete", why: "public profile" },
  "users/{}/private": { action: "delete", why: "email, date of birth, consent, WTT stats" },
  "users/{}/achievements": { action: "delete", why: "own achievements" },
  "users/{}/blocked_users": { action: "delete", why: "own block list" },
  "users/{}/xpMarkers": { action: "delete", why: "own XP anti-farming markers" },
  "users/{}/passport": { action: "delete", why: "own spot passport stamps" },
  "users/{}/checkins": { action: "delete", why: "own check-in log (location history)" },
  "users/{}/profileCustom": { action: "delete", why: "own profile customization" },
  usernames: { action: "delete", why: "reservation released when held by this uid" },

  // ── Closet ──
  "users/{}/locker": { action: "delete", why: "own closet copies" },
  "users/{}/wallet": { action: "delete", why: "Hubba Bucks balance" },
  "users/{}/ledger": { action: "delete", why: "Hubba Bucks transaction history" },
  "users/{}/closetLimits": { action: "delete", why: "own daily closet counters (functions only, no rules block)" },
  "users/{}/closetDesigns": { action: "delete", why: "own Closet Studio designs" },
  trades: {
    action: "anonymize",
    why: "the other skater's trade history; open trades are cancelled, held ones unwound and refunded first",
  },
  serials: {
    action: "anonymize",
    why: "public provenance of a numbered item; ownerUid and every history entry naming this account are scrubbed, including items they traded away",
  },
  "drops/{}/claims": { action: "delete", why: "own drop claim" },
  "drops/{}/entries": { action: "delete", why: "own drop raffle entry" },
  catalog: { action: "none", why: "item definitions" },
  drops: { action: "none", why: "drop definitions" },
  closetAudit: { action: "retain", why: "operator custody audit of admin mints and reversals; admin-only" },

  // ── Games ──
  games: {
    action: "delete",
    why: "finished S.K.A.T.E. games and their videos are deleted; active games are forfeited to the opponent and anonymized (own uploads deleted, uid/username tombstoned); games this account judged are anonymized",
  },
  diceGames: { action: "anonymize", why: "the other player's match history; open matches are closed first" },
  diceStats: { action: "delete", why: "own dice stats" },
  diceCreateLimits: { action: "delete", why: "own create cooldown" },
  xpPairs: {
    action: "retain",
    why: "daily XP anti-farming counter; holds only {utcDay, count}, the uid appears only inside a pair id and the doc is overwritten daily",
  },
  nudges: { action: "delete", why: "nudges sent and received" },
  nudge_limits: { action: "delete", why: "own nudge cooldowns" },

  // ── Clips, disputes, judging ──
  clips: { action: "delete", why: "own clips" },
  "clips/{}/comments": { action: "delete", why: "own comments on any clip, and the whole thread under a deleted clip" },
  clipVotes: { action: "delete", why: "own upvotes, with the clip tally decremented" },
  disputes: { action: "delete", why: "disputes this user raised" },
  disputeVotes: { action: "delete", why: "own dispute votes, with the tally decremented" },
  trainingLabels: { action: "delete", why: "labels on clips this user filmed" },
  trainingRevocations: { action: "delete", why: "own consent-withdrawal marker" },
  wttVotes: { action: "delete", why: "own What's That Trick votes" },
  wttItems: { action: "none", why: "clip-level quiz items" },
  wttGold: { action: "none", why: "answer keys" },

  // ── Map and spots ──
  spots: {
    action: "anonymize",
    why: "public spots stay for everyone's check-ins, stamps, chat and games; createdBy becomes the tombstone",
  },
  "spots/{}/comments": { action: "delete", why: "own spot comments" },
  "spots/{}/messages": { action: "delete", why: "own spot chat messages" },
  privateSpots: { action: "delete", why: "own private and crew spots; this uid is also removed from other crews" },
  spotMessageReports: { action: "delete", why: "spot-chat reports this user filed" },
  "spotPresence/{}/here": { action: "delete", why: "live presence at a spot" },
  mapState: { action: "delete", why: "own check-in anti-spoofing state (last location fix)" },
  passportSettings: { action: "delete", why: "own passport visibility" },
  skaterActivity: { action: "delete", why: "own who's-skating row" },
  onlineStatus: { action: "delete", why: "own online heartbeat" },

  // ── Notifications and push ──
  notifications: { action: "delete", why: "notifications this user received or sent" },
  notification_limits: { action: "delete", why: "own send cooldowns" },
  pushTargets: { action: "delete", why: "device tokens" },
  push_dispatch: { action: "delete", why: "queued pushes to this user's devices" },
  push_dispatch_limits: { action: "delete", why: "own push cooldowns" },

  // ── Moderation ──
  reports: {
    action: "delete",
    why: "reports this user filed; reports filed AGAINST them are kept as another user's submission",
  },
  reports_limits: { action: "delete", why: "own report cooldowns" },
  moderationStatements: { action: "delete", why: "statements of reasons about this user" },
  appeals: { action: "delete", why: "appeals this user filed" },
  bans: {
    action: "retain",
    why: "moderation record keyed by uid; existing behavior, kept so a deletion cannot be used to erase a ban",
  },
  adminAudit: { action: "retain", why: "append-only admin action log; admin-only" },

  // ── Pro community ──
  proReviews: { action: "delete", why: "own pro reviews" },
  proChallenges: { action: "delete", why: "challenges this pro posted" },
  proChallengeEntries: { action: "delete", why: "own challenge entries" },
  proProps: { action: "delete", why: "props sent by or to this user" },
  proFeatured: { action: "delete", why: "clips this pro featured" },
  proGold: {
    action: "retain",
    why: "a pro's answer key for a quiz clip, copied into wttGold; no personal content beyond the pro's uid. Follow-up: anonymize once WTT quiz lifecycle is settled",
  },
  proBlessings: {
    action: "retain",
    why: "public pro lineage (who blessed whom) involving a second person. Follow-up: anonymize",
  },

  // ── App config ──
  config: { action: "none", why: "feature flags; config/featureTesters lists tester uids and is managed by hand" },
  announcements: { action: "none", why: "admin announcements" },
  billingAlerts: { action: "none", why: "ops alerts" },
};

/** Storage, keyed by top-level folder (see storage.rules). */
export const STORAGE_ERASURE: Readonly<Record<string, ErasureEntry>> = {
  games: { action: "delete", why: "videos of every game the orchestrator deletes" },
  users: { action: "delete", why: "the whole users/{uid}/ folder: avatar, banner and resize-extension thumbnails" },
  closetDesigns: { action: "delete", why: "Closet Studio artwork" },
  userClips: { action: "delete", why: "private clip uploads" },
  approvedClips: { action: "delete", why: "approved clip videos" },
};

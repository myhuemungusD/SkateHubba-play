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
  proAudit: {
    action: "retain",
    why: "append-only admin log of pro seeds (actor, target, reason, evidence); admin-only, kept so a deletion cannot erase who minted a pro",
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

// ── Download my data ────────────────────────────────────────────────────────

/**
 * How "Download my data" reads one collection, as the signed-in owner, in the
 * browser. Each read has to carry the constraint its read rule checks (rules
 * are not filters), and uses equality filters only, so the automatic
 * single-field indexes serve it (see src/services/userDataQueries.ts).
 *
 *   uidDoc          `<collection>/{uid}`
 *   ownDoc          `users/{uid}/<sub>/<id>`, one fixed doc id
 *   ownList         every doc in `users/{uid}/<sub>`
 *   usernameDoc     `usernames/{username}`
 *   where           `<collection>` where `field == uid` (plus fixed `also` filters)
 *   arrayContains   `<collection>` where `field` array-contains uid
 *   group           collection group `<last segment>` where `field == uid`
 *   underEachParent `<parent>/{id}/<sub>/{uid}` for every parent doc
 */
export type ExportRead =
  | { kind: "uidDoc" }
  | { kind: "ownDoc"; id: string }
  | { kind: "ownList" }
  | { kind: "usernameDoc" }
  | { kind: "where"; field: string; also?: Readonly<Record<string, string | boolean>> }
  | { kind: "arrayContains"; field: string }
  | { kind: "group"; field: string }
  | { kind: "underEachParent" };

/** One collection in the export: which file section it lands in and how it's read. */
export interface ExportIncluded {
  /** Key in the export file. Several collections can share one section. */
  section: string;
  /** Plain-words name for the file notice and the on-screen warning. */
  name: string;
  reads: readonly ExportRead[];
  /**
   * Top-level fields dropped before the doc goes in the file: device tokens
   * and the uids of the admins or moderators who acted on the account.
   */
  redact?: readonly string[];
}

/** A collection left out of the export on purpose. */
export interface ExportExcluded {
  /** Why it is left out. Required: the coverage test rejects an empty reason. */
  excluded: string;
  /** What would let it be exported, when it holds the user's data but can't be read today. */
  fix?: string;
}

export type ExportPlan = ExportIncluded | ExportExcluded;

/**
 * Admin and moderator identity fields that can sit on a doc the user is
 * allowed to read. They name staff, not the user, so the file leaves them out.
 */
const STAFF_FIELDS = {
  users: ["verifiedBy"],
  reports: ["resolvedBy"],
  moderationStatements: ["createdBy"],
  appeals: ["reviewedBy"],
  disputes: ["adminRuledBy"],
  bans: ["bannedBy"],
  proBlessings: ["revokedBy"],
} as const;

const RATE_LIMIT = "send and report cooldowns";

/**
 * What "Download my data" (GDPR Art. 15/20) does with every collection in
 * {@link FIRESTORE_ERASURE}. Same keys, so a collection that deletion knows
 * about can't be missing from the export: `user-data-export.coverage.test.ts`
 * fails unless every key is either read here or excluded with a reason. The
 * export in src/services/userData.ts is built from this table and nothing
 * else.
 */
export const FIRESTORE_EXPORT = {
  // ── Identity ──
  users: { section: "profile", name: "profile", reads: [{ kind: "uidDoc" }], redact: STAFF_FIELDS.users },
  "users/{}/private": {
    section: "privateProfile",
    name: "account details",
    reads: [{ kind: "ownList" }],
    redact: ["fcmTokens"],
  },
  "users/{}/achievements": { section: "achievements", name: "achievements", reads: [{ kind: "ownList" }] },
  "users/{}/blocked_users": { section: "blockedUsers", name: "blocked list", reads: [{ kind: "ownList" }] },
  "users/{}/xpMarkers": { section: "xpMarkers", name: "XP history", reads: [{ kind: "ownList" }] },
  "users/{}/passport": { section: "passport", name: "spot passport", reads: [{ kind: "ownList" }] },
  "users/{}/checkins": { section: "checkins", name: "check-ins", reads: [{ kind: "ownList" }] },
  "users/{}/profileCustom": {
    section: "profileCustom",
    name: "profile customization",
    reads: [{ kind: "ownDoc", id: "main" }],
  },
  usernames: { section: "usernameReservation", name: "username", reads: [{ kind: "usernameDoc" }] },

  // ── Closet ──
  "users/{}/locker": { section: "locker", name: "closet", reads: [{ kind: "ownList" }] },
  "users/{}/wallet": { section: "wallet", name: "Hubba Bucks balance", reads: [{ kind: "ownList" }] },
  "users/{}/ledger": { section: "ledger", name: "Hubba Bucks history", reads: [{ kind: "ownList" }] },
  "users/{}/closetLimits": {
    excluded: "daily closet counters written only by Cloud Functions; no rules block, so the client can't read them",
    fix: "add `allow get: if isOwner(uid)` under users/{uid}/closetLimits, or export them server-side",
  },
  "users/{}/closetDesigns": { section: "closetDesigns", name: "Closet Studio designs", reads: [{ kind: "ownList" }] },
  trades: {
    section: "trades",
    name: "trades",
    reads: [
      { kind: "where", field: "fromUid" },
      { kind: "where", field: "toUid" },
    ],
  },
  serials: {
    section: "serials",
    name: "numbered items",
    // Items the user traded away name them only inside history[], which a
    // query can't match. Those stay out; see the audit.
    reads: [{ kind: "where", field: "ownerUid" }],
  },
  "drops/{}/claims": { section: "dropClaims", name: "drop claims", reads: [{ kind: "underEachParent" }] },
  "drops/{}/entries": { section: "dropEntries", name: "drop entries", reads: [{ kind: "underEachParent" }] },
  catalog: { excluded: "item definitions; no per-user data" },
  drops: { excluded: "drop definitions; no per-user data (the user's claims and entries are exported)" },
  closetAudit: { excluded: "operator custody log of admin mints and reversals; admin-only staff record" },

  // ── Games ──
  games: {
    section: "games",
    name: "game history",
    reads: [
      { kind: "where", field: "player1Uid" },
      { kind: "where", field: "player2Uid" },
      { kind: "where", field: "judgeId" },
    ],
  },
  diceGames: {
    section: "diceGames",
    name: "dice games",
    reads: [{ kind: "arrayContains", field: "playerUids" }],
  },
  diceStats: { section: "diceStats", name: "dice stats", reads: [{ kind: "uidDoc" }] },
  diceCreateLimits: {
    excluded: "one create-cooldown timestamp; rules deny every client read",
    fix: "add `allow get: if isOwner(uid)` on diceCreateLimits/{uid}",
  },
  xpPairs: {
    excluded:
      "functions-only anti-farming counter {utcDay, count}; the uid appears only inside the pair id with another skater's uid, and there is no rules block",
  },
  nudges: {
    section: "nudges",
    name: "nudges",
    reads: [
      { kind: "where", field: "senderUid" },
      { kind: "where", field: "recipientUid" },
    ],
  },
  nudge_limits: {
    excluded:
      "nudge cooldowns; the read rule checks the doc id (`limitId.matches(uid + '_.+')`), which a query can't prove, so a list is refused",
    fix: "change the nudge_limits read rule to `resource.data.senderUid == request.auth.uid` so a senderUid query passes",
  },

  // ── Clips, disputes, judging ──
  clips: { section: "clips", name: "clips", reads: [{ kind: "where", field: "playerUid" }] },
  "clips/{}/comments": { section: "comments", name: "comments", reads: [{ kind: "group", field: "userId" }] },
  clipVotes: { section: "clipVotes", name: "clip votes", reads: [{ kind: "where", field: "uid" }] },
  disputes: {
    section: "disputes",
    name: "disputes",
    reads: [
      { kind: "where", field: "setterUid" },
      { kind: "where", field: "matcherUid" },
    ],
    redact: STAFF_FIELDS.disputes,
  },
  disputeVotes: { section: "disputeVotes", name: "dispute votes", reads: [{ kind: "where", field: "uid" }] },
  trainingLabels: {
    excluded: "trick labels derived from clips the user filmed; rules allow only admins to read them",
    fix: "add an owner read on trainingLabels (resource.data.ownerUid == request.auth.uid), or export them server-side",
  },
  trainingRevocations: {
    excluded: "one consent-withdrawal marker; rules deny every client read",
    fix: "add `allow get: if isOwner(uid)` on trainingRevocations/{uid}",
  },
  wttVotes: { section: "wttVotes", name: "What's That Trick votes", reads: [{ kind: "where", field: "uid" }] },
  wttItems: { excluded: "clip-level quiz items; no per-user data" },
  wttGold: { excluded: "quiz answer keys; no per-user data, and secret by design" },

  // ── Map and spots ──
  spots: {
    section: "spots",
    name: "spots",
    // Rules only let anyone read active spots. Spots a moderator turned off
    // are a separate follow-up (owner read on own inactive spots).
    reads: [{ kind: "where", field: "createdBy", also: { isActive: true } }],
  },
  "spots/{}/comments": { section: "comments", name: "comments", reads: [{ kind: "group", field: "userId" }] },
  "spots/{}/messages": {
    section: "spotMessages",
    name: "spot chat messages",
    reads: [{ kind: "group", field: "userId" }],
  },
  privateSpots: {
    section: "privateSpots",
    name: "private spots",
    // Crew spots someone else created are their data, not this user's.
    reads: [{ kind: "where", field: "createdBy", also: { isActive: true } }],
  },
  spotMessageReports: {
    section: "spotMessageReports",
    name: "spot chat reports",
    reads: [{ kind: "where", field: "reportedBy" }],
  },
  "spotPresence/{}/here": { section: "spotPresence", name: "spot presence", reads: [{ kind: "group", field: "uid" }] },
  mapState: { section: "mapState", name: "map state", reads: [{ kind: "uidDoc" }] },
  passportSettings: { section: "passportSettings", name: "passport settings", reads: [{ kind: "uidDoc" }] },
  skaterActivity: { section: "skaterActivity", name: "who's skating status", reads: [{ kind: "uidDoc" }] },
  onlineStatus: { section: "onlineStatus", name: "online status", reads: [{ kind: "uidDoc" }] },

  // ── Notifications and push ──
  notifications: {
    section: "notifications",
    name: "notifications",
    // Notifications the user SENT are readable only by their recipient, so
    // they stay out; the user's side of them is in games, nudges and props.
    reads: [{ kind: "where", field: "recipientUid" }],
  },
  notification_limits: {
    section: "notificationLimits",
    name: RATE_LIMIT,
    reads: [{ kind: "where", field: "senderUid" }],
  },
  pushTargets: {
    excluded:
      "push device tokens; a credential for reaching the device, not something to put in a downloadable file, and rules deny list",
  },
  push_dispatch: {
    excluded:
      "queued pushes; each doc carries the recipient's device tokens, and the text is already in the notifications section",
  },
  push_dispatch_limits: {
    section: "pushDispatchLimits",
    name: RATE_LIMIT,
    reads: [{ kind: "where", field: "senderUid" }],
  },

  // ── Moderation ──
  reports: {
    section: "reports",
    name: "reports",
    reads: [{ kind: "where", field: "reporterUid" }],
    redact: STAFF_FIELDS.reports,
  },
  reports_limits: { section: "reportLimits", name: RATE_LIMIT, reads: [{ kind: "where", field: "reporterUid" }] },
  moderationStatements: {
    section: "moderationStatements",
    name: "moderation notices",
    reads: [{ kind: "where", field: "subjectUid" }],
    redact: STAFF_FIELDS.moderationStatements,
  },
  appeals: {
    section: "appeals",
    name: "appeals",
    reads: [{ kind: "where", field: "appellantUid" }],
    redact: STAFF_FIELDS.appeals,
  },
  bans: { section: "ban", name: "ban record", reads: [{ kind: "uidDoc" }], redact: STAFF_FIELDS.bans },
  adminAudit: { excluded: "append-only admin action log; admin-only staff record" },

  // ── Pro community ──
  proReviews: {
    excluded: "a pro's reviews; rules deny every client read",
    fix: "add an owner read on proReviews (resource.data.uid == request.auth.uid)",
  },
  proChallenges: { section: "proChallenges", name: "pro challenges", reads: [{ kind: "where", field: "proUid" }] },
  proChallengeEntries: {
    section: "proChallengeEntries",
    name: "pro challenge entries",
    reads: [{ kind: "where", field: "uid" }],
  },
  proProps: {
    section: "proProps",
    name: "props",
    reads: [
      { kind: "where", field: "fromUid" },
      { kind: "where", field: "toUid" },
    ],
  },
  proFeatured: { section: "proFeatured", name: "featured clips", reads: [{ kind: "where", field: "proUid" }] },
  proGold: { excluded: "a pro's quiz answer key; secret by design and rules deny every client read" },
  proAudit: { excluded: "append-only admin log of pro seeds; admin-only staff record" },
  proBlessings: {
    section: "proBlessings",
    name: "pro blessings",
    reads: [
      { kind: "where", field: "blesserUid" },
      { kind: "where", field: "targetUid" },
    ],
    redact: STAFF_FIELDS.proBlessings,
  },

  // ── App config ──
  config: {
    excluded:
      "feature flags; config/featureTesters is a hand-managed list of every tester's uid, so exporting it would hand out other users' uids",
  },
  announcements: { excluded: "admin announcements; no per-user data" },
  billingAlerts: { excluded: "ops alerts; no per-user data" },
} as const satisfies Record<string, ExportPlan>;

/** Every section name the export file can hold. */
export type ExportSection = Extract<
  (typeof FIRESTORE_EXPORT)[keyof typeof FIRESTORE_EXPORT],
  ExportIncluded
>["section"];

type IncludedPlan = Extract<(typeof FIRESTORE_EXPORT)[keyof typeof FIRESTORE_EXPORT], ExportIncluded>;

/** Sections filled by one doc read (the profile, a uid-keyed doc): one doc or null in the file. */
export type ExportDocSection = Extract<
  IncludedPlan,
  { reads: readonly [{ kind: "uidDoc" | "ownDoc" | "usernameDoc" }] }
>["section"];

/** Sections filled by lists: an array in the file. */
export type ExportListSection = Exclude<ExportSection, ExportDocSection>;

# Firestore Schema

## Database

- **Named database:** `"skatehubba"` (not the default Firestore database)
- **Set in:** `src/firebase.ts` as the third argument to `initializeFirestore()`
- **Firebase project:** `sk8hub-d7806`

> **Important for CLI users:** Because this is a named database, some Firebase CLI commands require the `--database skatehubba` flag. Rules deployment via `firebase.json` handles this automatically when configured correctly.

---

## Collections

### `users/{uid}` (public profile)

Player profiles. The document ID is the Firebase Auth UID. Holds **only**
fields that are safe to expose cross-user. Sensitive fields (email,
emailVerified, dob, parentalConsent, fcmTokens) live in the owner-only
subcollection `users/{uid}/private/*` below.

| Field               | Type        | Description                                              |
| ------------------- | ----------- | -------------------------------------------------------- |
| `uid`               | `string`    | Matches document ID and Auth UID                         |
| `username`          | `string`    | Normalized lowercase, 3–20 chars, `[a-z0-9_]+`           |
| `stance`            | `string`    | `"Regular"` or `"Goofy"`                                 |
| `createdAt`         | `Timestamp` | Server timestamp at profile creation                     |
| `wins`              | `number`    | Denormalized leaderboard win count                       |
| `losses`            | `number`    | Denormalized leaderboard loss count                      |
| `lastStatsGameId`   | `string`    | ID of the last game that updated stats (idempotency key) |
| `lastGameCreatedAt` | `Timestamp` | Server timestamp of last game creation (rate limiting)   |
| `isVerifiedPro`     | `boolean`   | Admin-only — clients cannot set or modify                |
| `verifiedBy`        | `string`    | Admin-only — grantor of verified-pro status              |
| `verifiedAt`        | `Timestamp` | Admin-only — when verified-pro was granted               |

**Constraints (enforced by Firestore rules):**

- `uid` and `username` are immutable after creation
- `username` format is validated on create
- Sensitive fields (`email`, `emailVerified`, `dob`, `parentalConsent`,
  `fcmTokens`) are **forbidden** at the top level on both create and
  update. The rules reject any write that tries to re-introduce them
  — they must go through `users/{uid}/private/profile` instead.
- `isVerifiedPro`/`verifiedBy`/`verifiedAt` are immutable from the client

**Access:** Any signed-in user can read any profile (needed for opponent lookup). Only the owner can write, and only once.

---

### `users/{uid}/private/profile` (private profile)

Owner-only companion doc for `users/{uid}`. Holds every field that
would leak PII or account state if exposed cross-user. Readable and
writable only by the owning user per `firestore.rules`.

| Field             | Type      | Description                                                                    |
| ----------------- | --------- | ------------------------------------------------------------------------------ |
| `emailVerified`   | `boolean` | Mirrors Auth state at profile creation time                                    |
| `dob`             | `string`  | YYYY-MM-DD, collected at age gate (COPPA/CCPA)                                 |
| `parentalConsent` | `boolean` | Optional; present when the age-gate collected consent for 13-17 year olds      |
| `fcmTokens`       | `array`   | Firebase Cloud Messaging tokens for this user's devices (≤10 entries enforced) |

> Note: email is **not** stored here. Firebase Auth is the canonical
> store for a user's email address. Duplicating it on Firestore would
> create a second source of truth.

**Constraints (enforced by Firestore rules):**

- Owner-only read/write/delete (`isOwner(uid)`)
- `fcmTokens` must be a list of ≤10 entries — prevents a compromised
  client from stuffing an unbounded blob into the push-token list

**Why the split:** Firestore rules cannot filter fields on reads —
read access is per-document. Splitting the profile is the enforcement
mechanism that keeps `fcmTokens`, `email`, `dob`, and `emailVerified`
out of cross-user reach while keeping the public fields (`username`,
`wins`, `losses`, `isVerifiedPro`) readable for opponent lookup.

**Access:** Only the owning user can read, write, or delete.

**Migration transition (April 2026):** Legacy `users/{uid}` documents
created before the public/private split still carry `email`,
`emailVerified`, `dob`, `parentalConsent`, and `fcmTokens` inline at
the top level. The Firestore rules currently run in a **transitional
mode** (see `firestore.rules` update block for `users/{uid}`): those
field names are allowed on the public doc at update-time IFF the value
is unchanged from the stored value, which lets legitimate partial
writes (`wins++`, stance changes, etc.) continue to work against
legacy docs before the backfill lands. Creates remain strict — no new
doc may introduce these fields.

**Deploy runbook:**

1. Ship this PR (rules + code + transitional guards) to production.
2. Operators run `scripts/migrate-users-private.mjs` (Admin SDK) to
   move the five sensitive fields from every legacy public user doc
   into its `users/{uid}/private/profile` companion and remove them
   from the public doc. The script is idempotent and resumable so it
   can be rerun safely.
3. After the backfill is verified (no public user doc still carries
   any of the five sensitive field names), land a follow-up PR that
   tightens the `users/{uid}` update rule back to the strict
   `!('X' in request.resource.data)` form, closing the residual
   transitional-tolerance window.

---

### `usernames/{username}`

Username uniqueness index. The document **key** is the normalized username. Used to prevent two users from claiming the same handle — even in a race condition.

| Field        | Type        | Description                                |
| ------------ | ----------- | ------------------------------------------ |
| `uid`        | `string`    | UID of the user who reserved this username |
| `reservedAt` | `Timestamp` | Server timestamp at reservation            |

**Constraints:**

- Immutable after creation — `update` and `delete` are blocked by rules
- Created atomically with the corresponding `users/{uid}` document inside a `runTransaction`

**Query pattern:** Point reads only (`getDoc("usernames/{normalized}")`). No collection queries are made against this collection.

**Access:** Any signed-in user can read. Write is restricted to the reserving user (`uid == auth.uid`).

---

### `games/{gameId}`

One document per game. Document ID is auto-generated by `addDoc()`.

| Field                    | Type                                                              | Description                                                                                                                |
| ------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `player1Uid`             | `string`                                                          | Challenger's UID                                                                                                           |
| `player2Uid`             | `string`                                                          | Opponent's UID                                                                                                             |
| `player1Username`        | `string`                                                          | Denormalized for display (avoids extra reads)                                                                              |
| `player2Username`        | `string`                                                          | Denormalized for display                                                                                                   |
| `player1IsVerifiedPro`   | `boolean?`                                                        | Denormalized verified-pro status, set at game creation                                                                     |
| `player2IsVerifiedPro`   | `boolean?`                                                        | Denormalized verified-pro status, set at game creation                                                                     |
| `p1Letters`              | `number`                                                          | Letters earned by player 1 (0–5)                                                                                           |
| `p2Letters`              | `number`                                                          | Letters earned by player 2 (0–5)                                                                                           |
| `status`                 | `string`                                                          | `"active"` \| `"complete"` \| `"forfeit"`                                                                                  |
| `currentTurn`            | `string`                                                          | UID of the player (or judge) who must act next                                                                             |
| `phase`                  | `string`                                                          | `"setting"` \| `"matching"` \| `"setReview"` \| `"disputable"` (the latter two only enter on judge-active games)           |
| `currentSetter`          | `string`                                                          | UID of the current trick setter                                                                                            |
| `currentTrickName`       | `string \| null`                                                  | `null` during the setting phase; set after `setTrick()`                                                                    |
| `currentTrickVideoUrl`   | `string \| null`                                                  | Firebase Storage download URL, or `null`                                                                                   |
| `matchVideoUrl`          | `string \| null`                                                  | Matcher's video URL, or `null`                                                                                             |
| `turnDeadline`           | `Timestamp`                                                       | 24 hours from last phase transition; rules cap to ≤48 h in the future to defend against opponent-lockout via huge values   |
| `turnNumber`             | `number`                                                          | Increments after each full trick round                                                                                     |
| `winner`                 | `string \| null`                                                  | Winner UID when `status !== "active"`, else `null`                                                                         |
| `turnHistory`            | `TurnRecord[]?`                                                   | Append-only history of completed turns (drives the clips feed and replay)                                                  |
| `spotId`                 | `string \| null`?                                                 | Optional skate spot the game is tied to. Set at creation, immutable                                                        |
| `judgeId`                | `string \| null`?                                                 | Optional referee UID (honor-system games are `null`)                                                                       |
| `judgeUsername`          | `string \| null`?                                                 | Denormalized referee username for display                                                                                  |
| `judgeStatus`            | `"pending" \| "accepted" \| "declined" \| null`?                  | Referee invite state; `accepted` unlocks the `setReview` and `disputable` paths                                            |
| `judgeReviewFor`         | `string \| null`?                                                 | UID of the player whose attempt/video the referee is currently reviewing                                                   |
| `createdAt`              | `Timestamp \| null`                                               | Server timestamp at game creation                                                                                          |
| `updatedAt`              | `Timestamp \| null`                                               | Server timestamp on every write                                                                                            |

> **Naming note:** The user-facing copy says "referee" everywhere, but the schema keeps the original `judge*` field names to avoid a Firestore migration for in-flight games. See the `[Unreleased]` section in [`CHANGELOG.md`](../CHANGELOG.md) for the full rationale.

**Query patterns:**

- Lobby: two parallel queries — `where("player1Uid", "==", uid)` and `where("player2Uid", "==", uid)`
- Gameplay: single-document listener — `onSnapshot(doc("games/{gameId}"))`
- No compound queries; no composite indexes required

**Constraints (enforced by Firestore rules):**

- `player1Uid`, `player2Uid`, `spotId`, and `judgeId` are immutable after creation
- `p1Letters` and `p2Letters` never decrease; at most one player gains one letter per update
- `turnDeadline` must be a future timestamp ≤48 h ahead on every write (defends against opponent-lockout via `Number.MAX_SAFE_INTEGER`)
- `updatedAt` must equal `request.time` on every write — pinning it server-side closes the stale-value bypass on the 2 s turn-action cooldown
- Status transitions: `active → complete` requires a player at 5 letters with correct winner; `active → forfeit` requires the current-turn player's deadline to have expired and the winner to be the opponent
- Phase transitions are validated explicitly (setting↔matching, judge-only setReview/disputable paths)
- Only the `currentTurn` UID can make turn writes (which may be a player OR the judge during dispute review)
- Either player can trigger a forfeit for an expired turn; either participant (player or judge) can trigger the auto-accept on an expired `disputable`/`setReview`
- Dispute / Call BS branches are gated on `judgeActive(game)` (`judgeId != null && judgeStatus == 'accepted'`)

**Access:** Both players can read; the nominated judge can also read once they accept. Only the two players (and, for dispute writes, the judge) can write.

---

### `nudges/{nudgeId}`

Push-notification pokes sent to an idle opponent. Writing a nudge document triggers a Cloud Function that delivers a push notification via FCM.

| Field            | Type        | Description                                         |
| ---------------- | ----------- | --------------------------------------------------- |
| `senderUid`      | `string`    | UID of the player sending the nudge                 |
| `senderUsername` | `string`    | Display name of the sender                          |
| `recipientUid`   | `string`    | UID of the player being nudged                      |
| `gameId`         | `string`    | The game this nudge relates to                      |
| `createdAt`      | `Timestamp` | Server timestamp at creation                        |
| `delivered`      | `boolean`   | Set to `false` on create; updated by Cloud Function |

**Constraints (enforced by Firestore rules):**

- `senderUid` must match the authenticated user
- `recipientUid` must differ from `senderUid` (no self-nudge)
- `delivered` must be `false` on create
- Updates are blocked for clients (only Admin SDK can mark delivered)
- Deletes are blocked

**Query patterns:** `where("recipientUid", "==", uid)`, ordered by `createdAt` desc, limited to 5.

**Access:** Sender or recipient can read. Only the authenticated sender can create. No client updates or deletes.

---

### `nudge_limits/{limitId}`

Rate-limiting index for nudges. Document ID is `{senderUid}_{gameId}`. Enforces a 1-hour cooldown between nudges per sender per game, server-side.

| Field          | Type        | Description                        |
| -------------- | ----------- | ---------------------------------- |
| `senderUid`    | `string`    | UID of the nudge sender            |
| `gameId`       | `string`    | The game this limit applies to     |
| `lastNudgedAt` | `Timestamp` | Server timestamp of the last nudge |

**Constraints (enforced by Firestore rules):**

- Document ID must equal `{senderUid}_{gameId}`
- `senderUid` must match the authenticated user on create
- Updates only allowed if `request.time > lastNudgedAt + 1 hour`
- Deletes are blocked

**Access:** Any signed-in user can read. Only the owning sender can create or update (with cooldown).

---

### `notifications/{notificationId}`

In-app notification documents written by the client when a game action occurs (e.g. "your turn", "new challenge"). The recipient's app listens via `onSnapshot` and surfaces notifications as in-app toasts.

| Field          | Type        | Description                                                                                  |
| -------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `senderUid`    | `string`    | UID of the player (or judge) writing the notification                                        |
| `recipientUid` | `string`    | UID of the player (or judge) who should see this notification                                |
| `type`         | `string`    | `"your_turn"` \| `"new_challenge"` \| `"game_won"` \| `"game_lost"` \| `"judge_invite"`      |
| `title`        | `string`    | Notification title (≤80 chars, capped by rules)                                              |
| `body`         | `string`    | Notification body text (≤200 chars, capped by rules)                                         |
| `gameId`       | `string`    | The game this notification relates to                                                        |
| `read`         | `boolean`   | `false` on create; set to `true` by recipient                                                |
| `createdAt`    | `Timestamp` | Server timestamp at creation; rules require `createdAt == request.time`                      |

**Constraints (enforced by Firestore rules):**

- `read` must be `false` on create
- Sender and recipient must both be participants (player OR nominated judge) of the referenced game
- 5-second per-(sender, game, type) cooldown enforced server-side via `notification_limits/{senderUid}_{gameId}_{type}`
- Title/body length capped to 80/200 characters
- Recipient can update only the `read` field; recipient can also delete their own notifications
- No one else can update or delete

**Query patterns:** `where("recipientUid", "==", uid) AND where("read", "==", false)`, ordered by `createdAt` desc — index declared in `firestore.indexes.json`.

**Access:** Only the recipient can read. Any participant of the referenced game can create. Only the recipient can update or delete.

---

### `billingAlerts/{alertId}`

Reserved for server-written billing-alert records. No client access. This project currently has no Cloud Functions deployed, so nothing is writing to this collection — the rules continue to lock it down against any future use.

**Access:** Fully blocked for clients (`allow read, write: if false`).

---

### `spots/{spotId}` and `spots/{spotId}/comments/{commentId}`

User-contributed skate spots. Active spots (`isActive == true`) are publicly readable so anonymous visitors landing on a `/challenge?spot=` link can preview the spot before signing in. Only email-verified signed-in users can create spots; creators may update their own spot but cannot mutate immutable fields (`latitude`, `longitude`, `createdBy`, `isVerified`, `isActive`). Spot creation is rate-limited to one per 30 s per user via `users/{uid}.lastSpotCreatedAt`.

The `comments` subcollection is signed-in-readable; comments require email verification, are immutable once posted, and are deletable only by the author.

See `firestore.rules` for the full type/length validation block (gnar/bust ratings 1–5, ≤14 obstacles, ≤5 photo URLs, name 1–80 chars, description ≤500 chars).

---

### `clips/{clipId}` and `clipVotes/{voteId}`

Denormalized landed-trick feed. `clips` documents are written atomically inside the `submitMatchAttempt` / `resolveDispute` transactions (see `src/services/clips.ts#writeLandedClipsInTransaction`). The document id is deterministic — `${gameId}_${turnNumber}_${role}` — which is also enforced by the create rule and keeps transaction retries idempotent.

`clipVotes/{voteId}` records single upvotes; the document id is `${uid}_${clipId}` and the rule enforces that shape so a client cannot impersonate another user's vote. Votes are immutable; only the voting user can delete their own vote (account-deletion cascade). Email verification is required to upvote.

Index: `(moderationStatus ASC, createdAt DESC, __name__ DESC)` declared in `firestore.indexes.json` for the chronological feed query.

---

## Relationships

```
users/{uid}.username ──────────────────── usernames/{username}.uid
                                              (reverse lookup index)

users/{uid} ─────────────────────────────  users/{uid}/private/profile
                                              (sensitive fields;
                                               owner-only readable)

games/{gameId}.player1Uid ─────────────── users/{uid}
games/{gameId}.player2Uid ─────────────── users/{uid}

games/{gameId} ──────────────────────────  Storage: games/{gameId}/turn-{N}/{role}.webm

nudges/{nudgeId}.gameId ─────────────────  games/{gameId}
nudges/{nudgeId}.senderUid ──────────────  users/{uid}
nudges/{nudgeId}.recipientUid ───────────  users/{uid}

nudge_limits/{senderUid_gameId} ─────────  users/{uid} + games/{gameId}

notifications/{id}.recipientUid ─────────  users/{uid}
notifications/{id}.gameId ───────────────  games/{gameId}
```

---

## Firebase Storage Layout

- **Bucket:** `sk8hub-d7806.firebasestorage.app`
- **Path:** `games/{gameId}/turn-{turnNumber}/{role}.{webm|mp4}`

| `role` value | Meaning                 |
| ------------ | ----------------------- |
| `"set"`      | Setter's trick video    |
| `"match"`    | Matcher's attempt video |

Web (MediaRecorder) emits `.webm`; native (Capacitor) emits `.mp4`. Storage rules accept both extensions paired with the matching content type.

Metadata stored per file:

| Key                            | Value                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `contentType`                  | `"video/webm"` or `"video/mp4"`                                                                |
| `customMetadata.uploaderUid`   | The uploading user's UID; rules enforce `request.auth.uid == metadata.uploaderUid` on writes   |
| `customMetadata.gameId`        | The game document ID                                                                           |
| `customMetadata.turn`          | Turn number as a string                                                                        |
| `customMetadata.role`          | `"set"` or `"match"`                                                                           |
| `customMetadata.uploadedAt`    | ISO 8601 timestamp                                                                             |
| `customMetadata.retainUntil`   | ISO 8601 timestamp (90-day hint for the Storage lifecycle rule provisioned by `infra/`)        |

---

## Data Lifecycle

| Entity               | Deletion policy                                                           |
| -------------------- | ------------------------------------------------------------------------- |
| User accounts        | Deleted on user request via account deletion flow                         |
| Private profile docs | Deleted atomically with the public user doc in the account-deletion batch |
| Usernames            | Deleted atomically with user profile during account deletion              |
| Games                | Deleted during account deletion (all games where user is a player)        |
| Videos               | Orphaned on game deletion; no automated cleanup implemented               |

---

## Schema Migration Notes

There is no migration tooling. Rules for safe changes:

**Adding a field** is safe. Existing documents won't have the field; code must handle `undefined`.

**Removing or renaming a field** requires a three-step deploy:

1. Deploy code that handles both the old and new shape.
2. Backfill existing documents.
3. Deploy code that only handles the new shape.

**Adding a required field to Firestore rules** will cause writes from old clients to fail and may break reads on old documents if the rule uses the new field. Coordinate rule changes with code changes carefully.

**Changing query patterns** that require a composite index: add the index in the Firebase Console (or `firestore.indexes.json`) before deploying the code change that uses it.

---

## Firestore Indexes

No composite indexes are currently required. All game queries use single-field equality filters (`player1Uid == uid`, `player2Uid == uid`), which Firestore indexes automatically.

If you add sorting or additional filters to game queries, check the Firebase Console → Firestore → Indexes tab — Firestore will log an error with a direct link to create the required index.

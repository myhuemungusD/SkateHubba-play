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
| `email`           | `string`  | Optional; only populated when a caller writes it (not written today)           |
| `fcmTokens`       | `array`   | Firebase Cloud Messaging tokens for this user's devices (≤10 entries enforced) |

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

| Field                  | Type                | Description                                                                |
| ---------------------- | ------------------- | -------------------------------------------------------------------------- |
| `player1Uid`           | `string`            | Challenger's UID                                                           |
| `player2Uid`           | `string`            | Opponent's UID                                                             |
| `player1Username`      | `string`            | Denormalized for display (avoids extra reads)                              |
| `player2Username`      | `string`            | Denormalized for display                                                   |
| `p1Letters`            | `number`            | Letters earned by player 1 (0–5)                                           |
| `p2Letters`            | `number`            | Letters earned by player 2 (0–5)                                           |
| `status`               | `string`            | `"active"` \| `"complete"` \| `"forfeit"`                                  |
| `currentTurn`          | `string`            | UID of the player who must act next                                        |
| `phase`                | `string`            | `"setting"` \| `"matching"` \| `"confirming"`                              |
| `currentSetter`        | `string`            | UID of the current trick setter                                            |
| `currentTrickName`     | `string \| null`    | `null` during the setting phase; set after `setTrick()`                    |
| `currentTrickVideoUrl` | `string \| null`    | Firebase Storage download URL, or `null`                                   |
| `matchVideoUrl`        | `string \| null`    | Matcher's video URL, or `null`                                             |
| `setterConfirm`        | `boolean \| null`   | Setter's decision on whether the matcher landed (`null` = not yet decided) |
| `matcherConfirm`       | `boolean \| null`   | Unused (kept for schema compatibility); always `null`                      |
| `turnDeadline`         | `Timestamp`         | 24 hours from last phase transition                                        |
| `turnNumber`           | `number`            | Increments after each full trick round                                     |
| `winner`               | `string \| null`    | Winner UID when `status !== "active"`, else `null`                         |
| `createdAt`            | `Timestamp \| null` | Server timestamp at game creation                                          |
| `updatedAt`            | `Timestamp \| null` | Server timestamp on every write                                            |

**Query patterns:**

- Lobby: two parallel queries — `where("player1Uid", "==", uid)` and `where("player2Uid", "==", uid)`
- Gameplay: single-document listener — `onSnapshot(doc("games/{gameId}"))`
- No compound queries; no composite indexes required

**Constraints (enforced by Firestore rules):**

- `player1Uid` and `player2Uid` are immutable after creation
- `p1Letters` and `p2Letters` never decrease; at most one player gains one letter per update
- Status transitions: `active → complete` requires a player at 5 letters with correct winner; `active → forfeit` requires correct winner assignment
- Only `currentTurn` player can make normal game updates
- Either player can trigger a forfeit for an expired turn

**Access:** Only the two players in the game can read or write it.

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

| Field          | Type        | Description                                                         |
| -------------- | ----------- | ------------------------------------------------------------------- |
| `recipientUid` | `string`    | UID of the player who should see this notification                  |
| `type`         | `string`    | `"your_turn"` \| `"new_challenge"` \| `"game_won"` \| `"game_lost"` |
| `title`        | `string`    | Notification title                                                  |
| `body`         | `string`    | Notification body text                                              |
| `gameId`       | `string`    | The game this notification relates to                               |
| `read`         | `boolean`   | `false` on create; set to `true` by recipient                       |
| `createdAt`    | `Timestamp` | Server timestamp at creation                                        |

**Constraints (enforced by Firestore rules):**

- `read` must be `false` on create
- Only the recipient can update (to mark as read)
- Updates cannot change any field except `read`
- Deletes are blocked

**Query patterns:** `where("recipientUid", "==", uid)`, ordered by `createdAt` desc, limited to 10.

**Access:** Only the recipient can read. Any signed-in user can create (to notify their opponent). Only the recipient can update.

---

### `billingAlerts/{alertId}`

Server-only collection written by the `onBillingAlert` Cloud Function. Stores billing threshold alerts for operational monitoring. No client access.

| Field      | Type       | Description                                                           |
| ---------- | ---------- | --------------------------------------------------------------------- |
| _(varies)_ | _(varies)_ | Written by Cloud Function; schema defined in `functions/src/index.ts` |

**Access:** Fully blocked for clients (`allow read, write: if false`). Only the Admin SDK (Cloud Functions) can read or write.

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
- **Path:** `games/{gameId}/turn-{turnNumber}/{role}.webm`

| `role` value | Meaning                 |
| ------------ | ----------------------- |
| `"set"`      | Setter's trick video    |
| `"match"`    | Matcher's attempt video |

Metadata stored per file:

| Key                          | Value                                                |
| ---------------------------- | ---------------------------------------------------- |
| `contentType`                | `"video/webm"`                                       |
| `customMetadata.gameId`      | The game document ID                                 |
| `customMetadata.turn`        | Turn number as a string                              |
| `customMetadata.role`        | `"set"` or `"match"`                                 |
| `customMetadata.uploadedAt`  | ISO 8601 timestamp                                   |
| `customMetadata.retainUntil` | ISO 8601 timestamp (90-day hint for lifecycle rules) |

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

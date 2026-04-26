# P0 Security & Data Integrity Audit

**Date:** 2026-03-21
**Scope:** Firestore rules, Storage rules, Auth domain config, turn timer enforcement

---

## 1. Firestore Security Rules Audit

### Collections Covered

| Collection                       | Read             | Write                            | Verdict                   |
| -------------------------------- | ---------------- | -------------------------------- | ------------------------- |
| `users/{uid}`                    | Authenticated    | Owner only                       | **PASS**                  |
| `usernames/{username}`           | Authenticated    | Creator only, no update          | **PASS**                  |
| `games/{gameId}`                 | Players only     | Complex state machine            | **PASS** (with notes)     |
| `nudges/{nudgeId}`               | Sender/recipient | Sender creates, no client update | **PASS**                  |
| `nudge_limits/{limitId}`         | Authenticated    | Owner, 1h rate-limit             | **PASS**                  |
| `billingAlerts/{alertId}`        | Denied           | Denied (server-only)             | **PASS**                  |
| `notifications/{notificationId}` | —                | —                                | **FAIL — no rules exist** |

### Detailed Findings

#### CRITICAL: `notifications` collection has NO security rules

The `notifications` collection is written to by client code (`src/services/notifications.ts`) but
has **zero Firestore rules** defined. Under Firestore's default-deny policy, these writes silently
fail in production (caught by the try/catch in `writeNotification`). (Historically, the removed
Cloud Functions `onGameUpdated` and `onGameCreated` also sent push via FCM as a fallback; those
are gone with the `functions/` package — in-app Firestore notifications plus client-side watchers
are now the only channels.)

**Risk:** If someone adds a wildcard match rule in the future, this collection would be wide-open.
The missing rules should be added now for defense-in-depth.

**Fix applied:** Added `notifications` collection rules — recipient can read their own, authenticated
users can create with validated fields, no client update/delete.

#### PASS: Users collection

- `create` — enforces `isOwner(uid)`, prevents overwriting existing docs, validates username format
  (`[a-z0-9_]+`, 3–20 chars), forces wins/losses to start at 0. **Solid.**
- `update` — username and uid immutable, wins/losses can only increment by 0 or 1. Prevents
  leaderboard inflation. **Solid.**
- `delete` — owner only (account deletion flow). **Acceptable.**

#### PASS: Usernames collection

- `create` — signed-in, uid matches auth, key validated with same regex. **Solid.**
- `update` — hard-denied. **Good.**
- `delete` — only by owning user. **Acceptable** (account deletion).

Note: Username reservation atomicity depends on Firestore's create-if-not-exists semantics, which is
correct — two concurrent creates for the same key will have one fail.

#### PASS: Games collection (with notes)

Thoroughly reviewed all four `allow update` rules:

1. **Normal turn update (setting phase):** Requires `currentTurn == auth.uid`, status active, valid
   phase transitions only (setting→matching or setting→setting), letters frozen, winner null,
   turnHistory frozen. Rate-limited to 1 write/2s. Player UIDs and usernames immutable. **Solid.**

2. **Match resolution:** Phase must be `matching`, auth must be currentTurn player. Letters can change
   by at most +1 for one player. Game either continues (setting, no winner) or completes (with winner).
   **Solid.**

3. **Forfeit:** `request.time > resource.data.turnDeadline` server-verified. Winner must be opponent
   of the timed-out player. Letters and player fields frozen. **Solid.**

4. **Delete:** Any player in the game. Acceptable for account deletion flow.

**Attack scenarios tested:**

| Attack                                               | Blocked by                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Spoofed UID (write as another player)                | `request.auth.uid == resource.data.currentTurn`                          |
| Cross-game write (write to game you're not in)       | `isPlayer(resource.data)`                                                |
| Letter manipulation (inflate own score)              | Letters frozen in normal updates; +1 cap in match resolution             |
| Instant-forfeit attack (set past deadline on create) | `turnDeadline > request.time` on create                                  |
| Premature forfeit                                    | `request.time > resource.data.turnDeadline`                              |
| Self-challenge                                       | `player2Uid != request.auth.uid` on create                               |
| Spam game creation                                   | 30-second rate limit via `lastGameCreatedAt`                             |
| Write flooding                                       | 2-second rate limit on turn updates                                      |
| Skip setting phase → claim win                       | Phase transition whitelist (setting→matching or setting→setting only)    |
| Winner injection during active game                  | `winner == null` enforced in normal/setting rules                        |
| Change player UIDs mid-game                          | Immutability checks on all update paths                                  |
| Forge turnHistory                                    | `turnHistory == resource.data.turnHistory` on normal updates and forfeit |

#### PASS: Nudges

- Sender must match auth UID, recipient must be different user, delivered starts false.
- No client update (Admin SDK only marks delivered). No delete. **Solid.**

#### PASS: Nudge rate limits

- Document ID must be `senderUid_gameId`. Update only allowed after 1-hour cooldown. **Solid.**

#### PASS: Billing alerts

- All access denied for clients. Server-only via Admin SDK. **Solid.**

---

## 2. Storage Security Rules Audit

**File:** `storage.rules`

### Rules Summary

| Path                                   | Read          | Write         | Constraints                                                                 |
| -------------------------------------- | ------------- | ------------- | --------------------------------------------------------------------------- |
| `games/{gameId}/{turnPath}/{fileName}` | Authenticated | Authenticated | 1KB–50MB, `video/webm` or `video/mp4`, filename `(set\|match)\.(webm\|mp4)` |
| Everything else                        | Denied        | Denied        | Default deny                                                                |

### Findings

#### MEDIUM: No game-membership check on Storage writes

Storage rules cannot cross-reference Firestore (this is a known Firebase limitation — documented in
a comment in the rules file). Any authenticated user can upload a video to any game path.

**Mitigating factors:**

- Firestore game rules validate that only the current-turn player can update `currentTrickVideoUrl`
  and `matchVideoUrl` fields, so an attacker can upload garbage to a path but can't inject it into
  the game document.
- Files must be `video/webm` (web) or `video/mp4` (native) and between 1KB–50MB.
- Filename restricted to `set.webm`, `set.mp4`, `match.webm`, or `match.mp4` — blocks path traversal.

**Recommendation:** This is an accepted limitation. The real access control is on the Firestore game
document, not the storage blob. An attacker could waste storage quota by uploading to arbitrary game
paths, but cannot affect gameplay. Consider adding App Check enforcement to Storage to further limit
abuse.

#### PASS: No public write

All write paths require `request.auth != null`. Default deny for all non-game paths. **Solid.**

#### MINOR: Read access is any authenticated user

Any authenticated user can read any game's videos, not just participants. For a social skating app
this is likely acceptable (game clips are shareable content). Flag only if videos are meant to be
private to the two players.

---

## 3. Auth Domain Whitelist Audit

### Configuration

Firebase Auth authorized domains are managed in the Firebase Console (Authentication → Settings →
Authorized domains), not in code. The codebase configures `authDomain` in two places:

1. **`src/firebase.ts:28-30`** — Pins `authDomain` to `skatehubba.com` when `VITE_APP_URL` matches
   the production URL. This prevents OAuth redirect mismatches if users arrive via legacy domains.

2. **`public/firebase-messaging-sw.js`** — Service worker receives `authDomain` via URL parameter.

### Findings

#### ACTION REQUIRED (manual): Verify Firebase Console authorized domains

The authorized domains list is not stored in the codebase — it's configured in the Firebase Console.

**Required manual check:**

1. Go to Firebase Console → Authentication → Settings → Authorized domains
2. Verify only these domains are listed:
   - `skatehubba.com` (production)
   - `localhost` (development)
   - Any currently-active Vercel preview domains you use
3. Remove any stale entries (e.g., old `skatehubba.xyz`, expired preview URLs, test domains)

The `DEPLOYMENT.md` docs correctly instruct adding authorized domains but don't specify removing
stale ones. The authDomain pin in `firebase.ts` is well-implemented.

---

## 4. Turn Timer Enforcement Audit

### Finding: NO server-side turn timer enforcement — CONFIRMED P0

The 24-hour turn timer (`turnDeadline`) is **client-enforced only**. There is no scheduled Cloud
Function, cron job, or any server-side process that checks expired deadlines and auto-forfeits.

**Current flow:**

1. Client sets `turnDeadline = Date.now() + 24h` on each turn transition (`src/services/games.ts`)
2. Client displays countdown via `<Timer>` and `<LobbyTimer>` components
3. When deadline passes, the **opponent's client** calls `forfeitExpiredTurn()` which writes the
   forfeit to Firestore
4. Firestore rules validate `request.time > resource.data.turnDeadline` server-side

**The vulnerability:** If the current-turn player closes the app and goes offline, forfeit only
happens when the **opponent** opens the app and their client detects the expired timer. If the
opponent also doesn't open the app, the game stays in limbo indefinitely. More critically:

- A malicious player can dodge losses by never opening the app after their turn expires
- The opponent must actively open the app to trigger the forfeit
- If neither player returns, the game remains "active" with an expired deadline forever

**Historical server-side fix:** A scheduled Cloud Function `checkExpiredTurns` previously ran
every 15 minutes, queried for active games with expired `turnDeadline`, and auto-forfeited them.
That function was removed with the rest of the `functions/` package. Only the client-side
`forfeitExpiredTurn` (`src/services/games.ts`) remains — it fires when any client opens the
game, so a game where neither player returns can linger in "active" state with an expired
deadline until one of them loads the app. This regression is pending product sign-off;
re-introducing a server-side sweeper requires an external scheduler since Cloud Functions are
disallowed by the no-backend guardrail.

---

## Summary of Changes Made

| #   | Severity     | Issue                                                   | Fix                                                                                                                      |
| --- | ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | **CRITICAL** | `notifications` collection has no Firestore rules       | Added rules for read/create/update/delete                                                                                |
| 2   | **P0**       | Turn timer is client-only — no server enforcement       | Client-side `forfeitExpiredTurn` transaction (server-side `checkExpiredTurns` was removed with the `functions/` package) |
| 3   | **MEDIUM**   | Storage allows any auth user to upload to any game path | Documented as accepted limitation (Firestore is the real gate)                                                           |
| 4   | **ACTION**   | Auth domain whitelist needs manual console verification | Documented steps above                                                                                                   |

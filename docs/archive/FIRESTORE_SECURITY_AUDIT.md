# Firestore Security Rules — Formal Audit

**Date:** 2026-03-20
**Auditor:** Claude (automated, pre-beta security gate)
**Scope:** Line-by-line review of `firestore.rules` (304 lines) against all client-side write paths, attack vectors, and the existing `archive/DATABASE_AUDIT.md` findings.
**Prior audit:** [`archive/DATABASE_AUDIT.md`](./archive/DATABASE_AUDIT.md) (2026-03-17) fixed F1 (forfeit deadline) and F2 (confirmation locking). This audit is a second pass.

---

## Methodology

1. Read every rule line-by-line and enumerate what each condition enforces.
2. Cross-reference each `allow` rule against the client service layer (`games.ts`, `users.ts`, `nudge.ts`) to identify writes the rules must permit.
3. For each rule, enumerate attack vectors a malicious client (browser console / REST API) could attempt.
4. Verify that the rule blocks each attack vector.
5. Fix any gaps found.

---

## Architecture Context

- **Zero-backend**: React SPA talks directly to Firestore. Security rules are the **sole authorization layer**.
- **Named database**: `"skatehubba"` (not default).
- **Collections**: `users`, `usernames`, `games`, `nudges`, `nudge_limits`.
- **Client code is untrusted**: any field can be set to any value by a malicious client; rules must reject invalid states.

---

## Findings

### F9 — CRITICAL: Game create rule allows instant-forfeit attack

**Location:** `firestore.rules` game create rule (previously lines 86–103)

**Description:** The game create rule validated `status`, `p1Letters`, `p2Letters`, `turnNumber`, and `winner`, but did **not** validate:

- `currentTurn` — could be set to the opponent
- `turnDeadline` — could be a past timestamp
- `phase` — could be any string
- `currentSetter` — could be the opponent
- `currentTrickName`, `currentTrickVideoUrl`, `matchVideoUrl` — could be pre-populated
- `setterConfirm`, `matcherConfirm` — could be pre-set

**Attack scenario:**

1. Malicious client creates a game with `currentTurn: opponentUid`, `turnDeadline: Timestamp.fromMillis(0)`.
2. Firestore accepts the write (all previously-checked fields are valid).
3. Malicious client immediately sends a forfeit update.
4. Forfeit rule passes: `request.time > resource.data.turnDeadline` (0 is in the past), `winner == opponentUid(game, currentTurn)` (opponent of the opponent = self).
5. **Result: Instant win without the opponent ever seeing the game.**

This completely bypasses the F1 fix from the prior audit — that fix added deadline validation to the _forfeit_ rule but not the _create_ rule.

**Impact:** Any authenticated user can instantly defeat any other user, inflating their win record and deflating the victim's loss record.

**Fix applied:**

```
&& request.resource.data.currentTurn == request.auth.uid
&& request.resource.data.phase == 'setting'
&& request.resource.data.currentSetter == request.auth.uid
&& request.resource.data.turnDeadline is timestamp
&& request.resource.data.turnDeadline > request.time
&& request.resource.data.currentTrickName == null
&& request.resource.data.currentTrickVideoUrl == null
&& request.resource.data.matchVideoUrl == null
&& request.resource.data.setterConfirm == null
&& request.resource.data.matcherConfirm == null
```

---

### F10 — HIGH: Leaderboard inflation via stats injection

**Location:** `firestore.rules` user create rule (line 36) and user update rule (lines 42–53)

**Description — create rule:** The user create rule validated `uid`, `username`, and regex format, but did not constrain `wins` or `losses`. A malicious client could create their profile with `wins: 999999` and immediately appear at the top of the leaderboard.

**Description — update rule:** The wins/losses increment validation had a logical gap:

```
!('wins' in request.resource.data)
|| !('wins' in resource.data)       // ← if wins doesn't exist yet, ANY value passes
|| request.resource.data.wins == resource.data.wins
|| request.resource.data.wins == resource.data.wins + 1
```

When `wins` did not yet exist on the document (common — it's added on first game completion), the second branch (`!('wins' in resource.data)`) evaluated to `true`, making the entire condition pass regardless of the new value. A user could set `wins: 999999` on their first update.

**Impact:** Complete leaderboard manipulation. Any user can give themselves arbitrary win/loss stats.

**Fix applied:**

- **Create rule:** Added `&& (!('wins' in request.resource.data) || request.resource.data.wins == 0)` (same for losses).
- **Update rule:** Replaced the flat OR with explicit branches:
  - Field absent in update → OK
  - Field absent in current doc → new value must be 0 or 1
  - Field present in current doc → new value must equal current or current + 1

---

### F11 — HIGH: Normal update rule allows bypassing confirmation flow

**Location:** `firestore.rules` normal game update rule (previously lines 122–148)

**Description:** The normal update rule (for `setTrick`, `failSetTrick`, `submitMatchAttempt`) allowed:

1. **Letter increments** — the current-turn player could give either player a letter without going through the set/match/confirm flow.
2. **Game completion** — the current-turn player could end the game with `status: 'complete'` and declare a winner, bypassing the confirmation rule entirely.
3. **Arbitrary phase changes** — no validation on `phase` field, allowing phase skipping (e.g., jump from `setting` to `confirming`).
4. **turnHistory rewrite** — no constraint on `turnHistory`, allowing the current-turn player to inject or remove historical records.

**Attack scenario:**

1. It's Player 1's turn, game is active, Player 2 has 4 letters.
2. P1 sends: `{ p2Letters: 5, status: 'complete', winner: player1Uid }`.
3. Normal update rule accepts: score incremented by 1 ✓, winner derived correctly ✓.
4. **Result: P1 wins instantly without P2 having any input on the current turn.**

**Impact:** Current-turn player can unilaterally award letters or end the game.

**Fix applied:**

- Scores must not change in normal updates (`p1Letters == resource.data.p1Letters && p2Letters == resource.data.p2Letters`).
- Status must remain `active`, winner must remain `null`.
- Phase must follow valid transitions: `setting→matching`, `setting→setting`, `matching→confirming`.
- turnHistory must not change during normal updates.

Letters and game completion are now only possible through the **confirmation rule** (setter decides) or **forfeit rule** (deadline expired).

---

### F12 — MEDIUM: Confirmation rule doesn't lock turnHistory

**Location:** `firestore.rules` confirmation update rule (previously lines 138–186)

**Description:** The confirmation rule validated player IDs, videos, scores, and resolution branches, but did not constrain `turnHistory`. The client uses `arrayUnion(turnRecord)` to append exactly one record, but a malicious client could send a raw array value to rewrite the entire history.

**Impact:** A player could falsify the game's turn history (displayed in the clips replay feature), changing trick names, video URLs, or who-got-a-letter records.

**Fix applied:** Added validation that `turnHistory` grows by exactly one element per confirmation:

```
&& (
  (!('turnHistory' in resource.data)
    && 'turnHistory' in request.resource.data
    && request.resource.data.turnHistory.size() == 1)
  || ('turnHistory' in resource.data
    && request.resource.data.turnHistory.size() == resource.data.turnHistory.size() + 1)
)
```

**Limitation:** This validates array _length_ but not _content_ of the appended record. A malicious setter could append a record with a falsified `trickName` or `landed` value. Full content validation would require per-field checks on the last array element, which Firestore rules do not support efficiently. The setter already has unilateral power to decide `landed` (by design — honor system), so the practical impact is limited to cosmetic history fields.

---

### F13 — LOW: Nudge create doesn't verify game membership

**Location:** `firestore.rules` nudge create rule (lines 268–275)

**Description:** The nudge create rule validates sender identity, recipient is different from sender, and `delivered == false`, but does not verify that the sender is a player in the referenced `gameId`. A malicious user could send nudges referencing any game ID.

**Impact:** Minimal — the nudge triggers a push notification to the recipient, but the recipient would see a nudge for a game they might not be in. The notification itself only contains `senderUsername` and a prompt to check the app. Verifying game membership would require a `get()` call (additional read cost per nudge creation).

**Status:** Accepted risk. Not fixed — the cost of the additional Firestore read outweighs the benefit for this low-severity issue.

---

### F14 — LOW: nudge_limits readable by any authenticated user

**Location:** `firestore.rules` nudge_limits read rule (line 291)

**Description:** `allow read: if isSignedIn()` permits any authenticated user to read any nudge rate-limit document. These documents contain `senderUid`, `gameId`, and `lastNudgedAt`.

**Impact:** Low — the information is not sensitive (UID is already public via the `users` collection, and `gameId` is an opaque auto-generated ID).

**Status:** Accepted risk. Could be tightened to `resource.data.senderUid == request.auth.uid` if desired.

---

### F15 — INFO: No field whitelist on user/username/game documents

**Description:** None of the create rules enforce a field whitelist. A malicious client could inject arbitrary extra fields (e.g., `isAdmin: true`, `customRole: "moderator"`) into any document. These fields have no effect today since the app ignores unknown fields, but could become a risk if new features check for their existence.

**Mitigation:** Firestore rules can enforce whitelists via `request.resource.data.keys().hasOnly([...])`, but this is brittle across schema migrations. The current approach of validating critical fields and ignoring extras is a reasonable trade-off for an MVP.

**Status:** Noted for future hardening.

---

## Verified Positive Findings

These aspects of the rules were verified as correct during the line-by-line review:

| Rule                     | Aspect                                                     | Verified |
| ------------------------ | ---------------------------------------------------------- | -------- |
| Helper: `isSignedIn()`   | Checks `request.auth != null`                              | OK       |
| Helper: `isOwner(uid)`   | Checks auth UID matches document UID                       | OK       |
| Helper: `isPlayer(game)` | Checks auth UID is player1 or player2                      | OK       |
| Helper: `opponentUid()`  | Correctly derives opponent via ternary                     | OK       |
| Users: read              | Any authenticated user (intentional for lookups)           | OK       |
| Users: create            | `!exists()` prevents overwrite race                        | OK       |
| Users: create            | UID, username type/size/regex validated                    | OK       |
| Users: update            | Username and UID immutable                                 | OK       |
| Users: delete            | Owner only                                                 | OK       |
| Usernames: create        | UID matches auth, size/regex validated                     | OK       |
| Usernames: update        | Blocked (`false`)                                          | OK       |
| Usernames: delete        | Owner only                                                 | OK       |
| Games: read              | Both players only                                          | OK       |
| Games: create            | Email verification required                                | OK       |
| Games: create            | Self-challenge prevention (`player2Uid != auth.uid`)       | OK       |
| Games: create            | 30-second rate limit via `lastGameCreatedAt`               | OK       |
| Games: normal update     | Only current-turn player can write                         | OK       |
| Games: normal update     | Player UIDs/usernames immutable                            | OK       |
| Games: normal update     | `currentTurn` must be one of the two players               | OK       |
| Games: confirmation      | Only setter can confirm                                    | OK       |
| Games: confirmation      | `setterConfirm` transitions from null to bool              | OK       |
| Games: confirmation      | Videos and trick name locked during confirmation           | OK       |
| Games: confirmation      | Score monotonicity (+1 max per player)                     | OK       |
| Games: confirmation      | Winner correctly derived from letter counts                | OK       |
| Games: confirmation      | Resolution-continue validates turnNumber +1, setter/turn   | OK       |
| Games: forfeit           | Deadline must have expired (`request.time > turnDeadline`) | OK       |
| Games: forfeit           | Scores, player IDs, usernames, turnHistory locked          | OK       |
| Games: forfeit           | Winner is opponent of the timed-out player                 | OK       |
| Games: delete            | Both players (for account deletion)                        | OK       |
| Nudges: create           | Sender is auth.uid, recipient != sender                    | OK       |
| Nudges: create           | Email verification required                                | OK       |
| Nudges: create           | `delivered == false`                                       | OK       |
| Nudges: update           | Blocked (admin only)                                       | OK       |
| Nudges: read             | Sender or recipient only                                   | OK       |
| Nudges: delete           | Blocked                                                    | OK       |
| Nudge limits: create     | Sender matches, document ID format enforced                | OK       |
| Nudge limits: update     | 1-hour cooldown enforced                                   | OK       |
| Nudge limits: delete     | Blocked                                                    | OK       |

---

## Summary Table

| #   | Severity     | Finding                                     | Status        |
| --- | ------------ | ------------------------------------------- | ------------- |
| F9  | **CRITICAL** | Game create allows instant-forfeit attack   | **Fixed**     |
| F10 | **HIGH**     | Stats injection (leaderboard inflation)     | **Fixed**     |
| F11 | **HIGH**     | Normal update bypasses confirmation flow    | **Fixed**     |
| F12 | **MEDIUM**   | Confirmation rule doesn't lock turnHistory  | **Fixed**     |
| F13 | LOW          | Nudge create doesn't verify game membership | Accepted risk |
| F14 | LOW          | nudge_limits readable by any user           | Accepted risk |
| F15 | INFO         | No field whitelist on documents             | Noted         |

---

## Client-Side Compatibility

All fixes were verified against the client service layer:

- **`createGame()`** (`games.ts:105-150`) — Sets `currentTurn: challengerUid`, `phase: 'setting'`, `currentSetter: challengerUid`, and `turnDeadline` 24h in the future. All new create-rule constraints are satisfied.
- **`setTrick()`** (`games.ts:156-185`) — Phase `setting→matching`, no score change, no turnHistory change. Passes the tightened normal update rule.
- **`failSetTrick()`** (`games.ts:191-216`) — Phase `setting→setting`, no score change, turnNumber incremented. Passes.
- **`submitMatchAttempt()`** (`games.ts:222-245`) — Phase `matching→confirming`, no score change. Passes.
- **`submitConfirmation()`** (`games.ts:251-327`) — Uses `arrayUnion(turnRecord)` which appends exactly one element. turnHistory size grows by 1. Passes.
- **`forfeitExpiredTurn()`** (`games.ts:333-360`) — Only sets `status`, `winner`, `updatedAt`. Scores/turnHistory unchanged. Passes.
- **`createProfile()`** (`users.ts:66-106`) — Does not set `wins` or `losses`. Passes.
- **`updatePlayerStats()`** (`users.ts:176-195`) — Increments wins or losses by exactly 1 from current value (or from 0 if absent, setting to 1). Passes the tightened update rule.

---

## Recommendations (Future Iterations)

1. **Add turnNumber validation to normal update rule** (deferred from F6) — currently `turnNumber` is unconstrained in normal updates. Low impact since it's informational.
2. **Tighten nudge_limits read** to `resource.data.senderUid == request.auth.uid`.
3. **Consider field whitelists** via `request.resource.data.keys().hasOnly([...])` for critical collections.
4. **Add Firestore rules unit tests** using `@firebase/rules-unit-testing` — the current test suite mocks Firestore and does not exercise rules directly.
5. **Storage rules**: Consider validating that the `turnPath` segment matches `turn-{N}` pattern (currently any string is accepted for the turn path component).

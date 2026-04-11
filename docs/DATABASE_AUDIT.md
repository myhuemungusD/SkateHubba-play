# Database Security Audit — SkateHubba

**Date:** 2026-03-17
**Scope:** Firestore security rules, Storage rules, client-side service layer, documentation accuracy
**Architecture:** Serverless React SPA → Firebase (Firestore, Auth, Storage) → Vercel hosting

---

## Executive Summary

SkateHubba's database layer is well-designed for a serverless app. Firestore security rules enforce authentication, field immutability, score validation, and game state machine transitions. PII exposure has been intentionally minimized by deprecating email storage. Security headers (HSTS, CSP, X-Frame-Options) are comprehensive.

Two security vulnerabilities were found in the Firestore rules:

1. **CRITICAL** — The forfeit rule does not validate that the turn deadline has actually expired, allowing a player to instantly forfeit their opponent's turn.
2. **HIGH** — The confirmation phase rule does not lock mutable game-state fields (`phase`, `currentTurn`, `turnDeadline`, `turnNumber`, `currentSetter`), allowing a malicious client to manipulate game state while submitting a vote.

Both are fixed in this commit.

---

## Architecture Overview

```
React SPA (Vite + TypeScript)
  ├── Firebase Auth (email/password, Google OAuth)
  ├── Cloud Firestore (named DB: "skatehubba")
  │     ├── users/{uid}           — Player profiles
  │     ├── usernames/{username}  — Username uniqueness index
  │     └── games/{gameId}        — Game state documents
  ├── Firebase Storage
  │     └── games/{gameId}/turn-{N}/{set|match}.{webm|mp4}
  └── Vercel (hosting + security headers)
```

No custom backend server. All authorization is enforced by Firestore/Storage security rules.

---

## Positive Findings

These areas are well-implemented:

| Area                       | Details                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| **No injection risk**      | Firestore SDK uses structured queries; no raw SQL or string interpolation                         |
| **Auth on all operations** | Every read/write requires `request.auth != null`                                                  |
| **Field immutability**     | Player UIDs and usernames cannot change after game creation                                       |
| **Score validation**       | Scores never decrease; at most +1 per update; winner derived from scores                          |
| **Game state machine**     | Phase transitions enforced in rules (setting → matching → confirming)                             |
| **Email verification**     | Required for game creation, enforced server-side in rules                                         |
| **Rate limiting**          | 30s cooldown between game creations (Firestore rule) + 10s client-side defense-in-depth           |
| **Atomic transactions**    | Profile + username reservation uses `runTransaction` to prevent races                             |
| **Input sanitization**     | Username regex `[a-z0-9_]+`, trick name trimmed and capped at 100 chars                           |
| **PII minimization**       | Email deprecated from Firestore profiles; delegated to Firebase Auth                              |
| **Storage constraints**    | Content type (video/webm on web, video/mp4 on native), size (1KB–50MB), filename whitelist `(set\|match)\.(webm\|mp4)` |
| **Security headers**       | HSTS (2yr+preload), CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, COOP, Permissions-Policy |
| **App Check**              | reCAPTCHA v3 integration blocks non-app traffic                                                   |
| **Retry with backoff**     | Exponential backoff with permanent-error detection avoids retry storms                            |

---

## Findings

### F1 — CRITICAL: Forfeit rule missing deadline validation

**Location:** `firestore.rules:190-202`

**Description:** The forfeit update rule checks that the game is active and that the winner is the opponent of the `currentTurn` player, but it does **not** verify that `request.time > resource.data.turnDeadline`. A malicious client can bypass the client-side deadline check (`games.ts:327`) and call the Firestore API directly to forfeit an opponent's turn immediately.

**Impact:** A player could win any game instantly by forfeiting their opponent's turn before the 24-hour deadline expires.

**Fix:** Add `&& request.time > resource.data.turnDeadline` to the forfeit rule.

---

### F2 — HIGH: Confirmation phase doesn't lock game-state fields

**Location:** `firestore.rules:138-186`

**Description:** During the `confirming` phase, the rule locks player IDs, usernames, videos, and trick name. However, it does not constrain `phase`, `currentTurn`, `currentSetter`, `turnDeadline`, or `turnNumber`. A malicious client could submit a vote while simultaneously changing the turn to themselves, resetting the phase, or manipulating the turn number.

The complication: when both votes are in, the resolving write legitimately changes `phase` back to `setting` and updates `currentSetter`, `currentTurn`, `turnDeadline`, and `turnNumber`. The fix must distinguish vote-only writes from resolution writes.

**Impact:** A malicious client could manipulate game state during the confirmation phase to gain an unfair advantage.

**Fix:** Split the status/winner check into three branches:

1. **Vote-only:** Lock all game-state fields (phase stays `confirming`, turn/setter/deadline/turnNumber unchanged)
2. **Resolution → complete:** Game ends (existing logic)
3. **Resolution → continue:** Phase resets to `setting`, turnNumber increments by exactly 1, currentSetter/currentTurn validated

**Post-fix bug found (F2b):** The initial F2 fix introduced a subtle rule/client mismatch. The confirmation rule locks `currentTrickVideoUrl`, `matchVideoUrl`, `currentTrickName`, and requires confirms to be bools (lines 148-162). But the client's resolution-continues path reset all of these to `null`, violating the locks. This would cause **all resolution-continues writes to be rejected by Firestore**, permanently sticking games in the confirming phase. Fixed by removing the null resets from the client — stale values are cleaned up by subsequent phase transitions (`setTrick`, `submitMatchAttempt`). Additionally, `currentSetter` and `currentTurn` are now validated in the resolution-continues rule branch.

---

### F3 — MEDIUM: No pagination on game queries

**Location:** `src/services/games.ts:372-373`

**Description:** `subscribeToMyGames()` runs two queries (`player1Uid == uid` and `player2Uid == uid`) with no `limit()` clause. For a player with hundreds of completed games, this loads the entire history on every page load.

Also affects `deleteUserData()` (`users.ts:113-115`) which fetches all games without limit during account deletion.

**Impact:** Performance degradation, excessive Firestore read costs, potential client-side memory issues for active players.

**Fix:** Add `limit(50)` to both queries. Consider filtering to active games only, or implementing cursor-based pagination for game history.

---

### F4 — MEDIUM: Storage read rules too permissive

**Location:** `storage.rules:11`

**Description:** `allow read: if request.auth != null` permits any authenticated user to read any game's video files. Storage rules cannot cross-reference Firestore documents, so verifying game membership is not possible at this layer.

**Mitigation:** Video URLs are only shared via Firestore game documents (which are player-restricted), and Storage URLs are not easily guessable without knowing the gameId and turn number. This is a known Firebase limitation.

**Impact:** Low risk in practice — an attacker would need to guess/obtain a valid gameId. But if a user shares a video URL, any authenticated user could access it.

**Recommendation:** Document this as an accepted risk. If privacy becomes critical, consider using Firebase Cloud Functions to generate signed URLs with short TTLs.

---

### F5 — LOW: DATABASE.md out of sync with code

**Location:** `docs/DATABASE.md`

**Discrepancies found:**

- `phase` field enum lists `"setting" | "matching"` but code includes `"confirming"` (line 71)
- Missing `setterConfirm` and `matcherConfirm` fields from games schema table
- Missing `lastGameCreatedAt` field from users schema table
- Data lifecycle section claims usernames and games are "Never deleted" but `deleteUserData()` deletes both
- Storage metadata table missing `retainUntil` custom metadata field

**Fix:** Update documentation to match actual schema.

---

### F6 — LOW: turnNumber not validated on update

**Location:** `firestore.rules:92-135`

**Description:** The normal update rule validates scores, status, and winner, but does not constrain `turnNumber` changes. A malicious client could set `turnNumber` to an arbitrary value. The practical impact is minimal since `turnNumber` is informational (used for sorting and video paths).

**Recommendation:** Add `request.resource.data.turnNumber == resource.data.turnNumber + 1 || request.resource.data.turnNumber == resource.data.turnNumber` to the normal update rule in a future iteration.

---

### F7 — INFO: No GDPR data export

Account deletion is implemented (`deleteUserData`), but there is no data export endpoint. If operating in GDPR jurisdictions, a data portability mechanism may be required.

---

### F8 — INFO: Video orphan cleanup

Deleted games leave orphaned videos in Storage. The codebase documents a `retainUntil` metadata hint for lifecycle rules, but no cleanup mechanism is implemented. Consider a Cloud Function triggered on game deletion or a scheduled Storage lifecycle rule.

---

## Summary Table

| #   | Severity | Finding                            | Status        |
| --- | -------- | ---------------------------------- | ------------- |
| F1  | CRITICAL | Forfeit missing deadline check     | **Fixed**     |
| F2  | HIGH     | Confirmation phase field locking   | **Fixed**     |
| F3  | MEDIUM   | No query pagination                | **Fixed**     |
| F4  | MEDIUM   | Storage read too broad             | Accepted risk |
| F5  | LOW      | Documentation drift                | **Fixed**     |
| F6  | LOW      | turnNumber not validated on update | Deferred      |
| F7  | INFO     | No GDPR data export                | Noted         |
| F8  | INFO     | Video orphan cleanup               | Noted         |

---

## Follow-Up Audit

A second-pass formal audit was conducted on 2026-03-20 — see **[FIRESTORE_SECURITY_AUDIT.md](./FIRESTORE_SECURITY_AUDIT.md)**. It found that the F1 fix (forfeit deadline) was incomplete: the game *create* rule did not validate `currentTurn`, `turnDeadline`, or `phase`, enabling a variant of the instant-forfeit attack. Additional findings include leaderboard inflation via stats injection and confirmation-flow bypass. All critical/high findings have been fixed.

---

## Action Items (Prioritized)

1. ~~Deploy Firestore rules fix for F1 (forfeit deadline) — **immediate**~~ ✅ Fixed
2. ~~Deploy Firestore rules fix for F2 (confirmation locking) — **immediate**~~ ✅ Fixed
3. ~~Add pagination to game queries (F3) — **short-term**~~ ✅ Fixed
4. ~~Sync DATABASE.md with actual schema (F5)~~ ✅ Fixed
5. Consider signed URLs for video privacy (F4) — **future**
6. Add turnNumber validation to update rules (F6) — **future**
7. Implement GDPR data export if needed (F7) — **future**
8. Implement video cleanup Cloud Function (F8) — **future**

# Game State Machine

This document formalizes the state machine that governs every game of
S.K.A.T.E. in SkateHubba. The source of truth is the Firestore `games`
collection. Client transitions happen inside atomic Firestore transactions in
`src/services/games.{create,match,judge,turns}.ts`; two phases are resolved
**only** by a server-side cron (`api/cron/resolve-expired-disputes.ts`).

> `src/services/games.ts` is a 22-line barrel re-export. It contains no logic —
> do not read it looking for implementation. The module map is in §Modules.

---

## States

`status` and `phase` are independent fields. `phase` is only meaningful while
`status === "active"`.

| `status`   | `phase`           | Description                                                                     |
| ---------- | ----------------- | ------------------------------------------------------------------------------- |
| `active`   | `setting`         | Current setter must name & record a trick                                       |
| `active`   | `matching`        | Matcher must attempt the trick (or "Call BS" on the set, if a judge is active)  |
| `active`   | `setReview`       | Judge reviews the setter's video after a "Call BS" (judge-only)                 |
| `active`   | `disputable`      | Judge reviews the matcher's "landed" claim (judge-only)                         |
| `active`   | `pendingReview`   | **Honor-system landed claim. Game is FROZEN** pending the setter's 24h decision |
| `active`   | `communityReview` | **Setter disputed the claim. Game is FROZEN** pending a 24h community vote      |
| `complete` | —                 | A player reached 5 letters; winner is recorded                                  |
| `forfeit`  | —                 | Turn timer expired; opponent wins automatically                                 |

Source of the union: `src/services/games.mappers.ts:27` (documented at `:12-26`).

### The two frozen phases

`pendingReview` and `communityReview` are **not** ordinary turn states. While a
game sits in either one, `currentSetter`, `currentTurn`, `turnNumber`, and both
letter counts are pinned — nothing advances.

- **`pendingReview`** has exactly one client exit, and it is gated on the
  **setter**, not the matcher: `firestore.rules:1459-1464` requires
  `request.auth.uid == resource.data.currentSetter`. The matcher who made the
  claim cannot resolve their own claim.
- **`communityReview`** has **no client `allow update` branch anywhere in
  `firestore.rules`**. The absence *is* the enforcement — only the Admin SDK
  referee can move a game out of it. This is invisible to grep; do not "helpfully"
  add a branch for it.

The turn-forfeit sweep deliberately skips both: `turnForfeit.shared.ts:146`
returns null for them, and the cron's reminder pass filters them via
`FROZEN_REVIEW_PHASES`. A frozen game can never be forfeited for inactivity.

### Judge status (game-level, independent of `phase`)

| `judgeStatus` | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `null`        | No judge was nominated — game runs on the honor system                 |
| `pending`     | Judge nominated but hasn't accepted yet — honor-system rules in effect |
| `accepted`    | Judge accepted — `disputable` and `setReview` paths unlock             |
| `declined`    | Judge declined — permanent honor system for this game                  |

`isJudgeActive(game)` (`games.mappers.ts:152`) is true only when `judgeId` is set
**and** `judgeStatus === "accepted"`. Everything else is the honor path.

---

## State Diagram

```
                        createGame()
                            │
                            ▼
                   ┌────────────────┐
                   │ active:setting │◄──────────────────────────────┐
                   └───────┬────────┘                               │
                           │ setTrick()                             │
                           ▼                                        │
                  ┌─────────────────┐◄───── judge: "clean" ───┐     │
             ┌───►│ active:matching │◄───── tie verdict ──────┤     │
             │    └───────┬─────────┘                         │     │
             │            │                                   │     │
             │  callBS()  │  submitMatchAttempt()             │     │
             │  (judge)   │                                   │     │
             ▼            ├──── landed=false ─────────────────┼─────┤
   ┌────────────────┐     │     matcher +1 letter             │     │
   │active:setReview│     │     (5 letters → complete)        │     │
   └───────┬────────┘     │                                   │     │
           │              └──── landed=true ──┐               │     │
           │ judgeRule()                      │               │     │
           │  clean   → matching       judge active?          │     │
           │  sketchy → setting        ┌──────┴───────┐       │     │
           │  (24h)   → matching      NO             YES      │     │
           └──────────────────┐        │              │       │     │
                              │        ▼              ▼       │     │
                              │ ┌──────────────┐ ┌──────────────┐   │
                              │ │  FROZEN      │ │   active:    │   │
                              │ │ pendingReview│ │  disputable  │   │
                              │ └──────┬───────┘ └──────┬───────┘   │
                              │        │                │           │
                              │  setter decides   judge rules (24h) │
                              │  within 24h       resolveDispute()  │
                              │        │                │           │
                    ┌─────────┴────┬───┴──────┐    ┌────┴─────┐     │
                    │              │          │    │          │     │
              acceptLanded()  raiseDispute()  │  accept    dispute  │
              (setter only)   (setter only)   │  (or 24h    +1 to   │
                    │              │       cron 24h auto-  matcher) │
                    │              ▼       auto-accept)      │      │
                    │      ┌──────────────┐   │       │      │      │
                    │      │   FROZEN     │   │       │      │      │
                    │      │communityReview│  │       │      │      │
                    │      └──────┬───────┘   │       │      │      │
                    │             │           │       │      │      │
                    │      cron, after 24h vote window │      │      │
                    │      ┌──────┼───────┬───────┐   │      │      │
                    │    land   bail    tie     none  │      │      │
                    │      │      │       │       │   │      │      │
                    │      │      │       └───────┼───┼──────┼──►matching
                    │      │      │               │   │      │      │
                    └──────┴──────┴───────────────┴───┴──────┴──────┘
                                  (roles swap, or setter keeps setting)


  setting/matching + turnDeadline expired
              │  forfeitExpiredTurn()  — client on game open, OR
              │  api/cron/sweep-expired-turns.ts every 15 min
              ▼
        ┌──────────┐
        │ forfeit  │
        └──────────┘

  pendingReview / communityReview  →  NEVER forfeit (frozen, sweep skips them)
```

---

## Transitions

Each entry names the module that actually implements it.

### `createGame(...)` — `games.create.ts`

- **Pre-condition:** client-side cooldown; `firestore.rules:1162` enforces a
  30-second server-side cooldown and blocks self-challenge
- **Writes:** `status: "active"`, `phase: "setting"`, `currentTurn`/`currentSetter`
  = challenger, `turnDeadline` = now + 24 h, `turnNumber: 1`, letters 0
- **Result:** `active:setting`

### `setTrick(gameId, trickName, videoUrl)` — `games.match.ts:16`

- **Pre-conditions:** `status === "active"`, `phase === "setting"`
- **Writes:** `phase: "matching"`, trick name + video, `currentTurn` → matcher,
  fresh 24 h deadline
- **Result:** `active:matching`

### `failSetTrick(gameId)` — `games.match.ts:83`

Setter concedes they cannot land their own set. Next setter, `turnNumber++`.
- **Result:** `active:setting`

### `submitMatchAttempt(gameId, matchVideoUrl, landed)` — `games.match.ts:143`

- **Pre-conditions:** `status === "active"`, `phase === "matching"`

#### Path A — matcher claims missed (`landed === false`) — `:256`

- Matcher gains 1 letter; turn resolves immediately
- `phase: "setting"`, `turnNumber++`, same `currentSetter`
- At 5 letters: `status: "complete"`, `winner` set
- **Result:** `active:setting` or `complete`

#### Path B — matcher claims landed, **no active judge** — `:207`

**This does not swap roles.** It freezes the game.

- Writes **only** `phase: "pendingReview"`, `reviewFor` = matcher,
  `reviewDeadline` = now + 24 h, `matchVideoUrl`, `updatedAt`
- `currentSetter`, `currentTurn`, `turnNumber` and both letter counts are
  deliberately left untouched
- The landed clip and the "Trick Landed" notification are **deferred** until the
  claim is actually accepted — a claim is not a landing yet
- The setter is notified that a claim opened the review window
- **Result:** `active:pendingReview` (frozen)

#### Path C — matcher claims landed, **judge accepted** — `:167`

- `phase: "disputable"`, `judgeReviewFor` = matcher, `currentTurn` → `judgeId`,
  fresh 24 h deadline
- **Result:** `active:disputable`

### `acceptLanded(gameId)` — `games.match.ts:388` · **setter only**

The deferred honor swap, executed once the setter accepts.

- **Pre-conditions:** `phase === "pendingReview"`, caller is `currentSetter`
  (`firestore.rules:1459-1530`)
- **Writes:** roles swap (`currentSetter` → matcher), `phase: "setting"`,
  `turnNumber++`, landed `TurnRecord` appended, clips written, "Trick Landed"
  notification sent
- **Result:** `active:setting`

### `raiseDispute(gameId)` — `disputes.raise.ts:93` · **setter only**

- **Pre-conditions:** `phase === "pendingReview"`, caller is `currentSetter`
  (`firestore.rules:1538-1548`)
- **Writes:** `phase: "communityReview"`, plus a new
  `disputes/{gameId}_{turnNumber}` document with `status: "open"` and a 24 h
  `reviewDeadline` (`firestore.rules:3033-3068`)
- **Result:** `active:communityReview` (frozen — no client can move it further)

### `callBSOnSetTrick(gameId)` — `games.judge.ts:24` · judge-active only

Matcher flags the setter's video before attempting.
- **Writes:** `phase: "setReview"`, `currentTurn` → `judgeId`, fresh deadline
- **Result:** `active:setReview`

### `judgeRuleSetTrick(gameId, clean)` — `games.judge.ts:78` · judge only

- **clean:** matcher must attempt → `active:matching`
- **sketchy:** setter must re-set → `active:setting`, set video cleared

### `resolveDispute(gameId, accept)` — `games.judge.ts:162` · judge only

- **Pre-conditions:** `phase === "disputable"`, caller is `judgeId`
- **accept:** no letters, roles swap, `turnNumber++` → `active:setting`
- **dispute:** matcher +1 letter, setter keeps setting → `active:setting`, or
  `complete` at 5 letters

### `forfeitExpiredTurn(gameId)` — `games.turns.ts:93`

Called on game-screen mount when the deadline has passed, and independently by
the server sweep. Decision logic is shared (`turnForfeit.shared.ts`) so the two
paths cannot diverge.

| Expired phase              | Outcome                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `setting` / `matching`     | `status: "forfeit"`, winner = opponent of `currentTurn`         |
| `disputable`               | Auto-accept — matcher's call stands, roles swap → `setting`     |
| `setReview`                | Set stands (benefit of the doubt) → `matching`                  |
| `pendingReview`            | **Not handled here** — cron only (see below)                    |
| `communityReview`          | **Not handled here** — cron only (see below)                    |

---

## Server-resolved transitions (cron only)

`api/cron/resolve-expired-disputes.ts`, scheduled `*/15 * * * *` by
`.github/workflows/resolve-expired-disputes.yml`. Bearer-`CRON_SECRET`
authenticated, `MAX_PER_RUN = 100` per phase, idempotent, dry-run capable.

### `pendingReview` + `reviewDeadline` lapsed

The setter never decided. The claim **auto-accepts**: roles swap, `turnNumber++`,
landed `TurnRecord` appended — identical to `acceptLanded`. No stat deltas are
written for a silent expiry.

### `communityReview` + `reviewDeadline` lapsed

The community vote is tallied and the verdict applied
(`dispute.resolution.shared.ts:120-280`). **Quorum is one vote.**

| Verdict         | Condition                    | Outcome                                                         |
| --------------- | ---------------------------- | --------------------------------------------------------------- |
| `land`          | `landVotes > bailVotes`      | Claim stands — roles swap, `turnNumber++` → `setting`           |
| `bail`          | `bailVotes > landVotes`      | Matcher +1 letter, setter keeps setting → `setting` or `complete` |
| `tie`           | equal, both non-zero         | Retry — `phase: "matching"`, `matchVideoUrl` cleared, no TurnRecord |
| `none`          | zero votes                   | Auto-accept, same as `land`                                     |

The dispute document is then closed with `status: "closed"`, its `verdict`, and
`resolutionApplied: true`. Community resolution also increments `tricksDisputed`
on the claimer and `disputesRaised`/`disputesRight`/`disputesWrong` on the
disputer.

---

## Modules

| Module | Owns |
| --- | --- |
| `games.mappers.ts` | types (`GameStatus`, `GamePhase`, `JudgeStatus`), `toGameDoc`, `isJudgeActive` |
| `games.create.ts` | `createGame`, `acceptJudgeInvite`, `declineJudgeInvite` |
| `games.match.ts` | `setTrick`, `failSetTrick`, `submitMatchAttempt`, `acceptLanded` |
| `games.judge.ts` | `callBSOnSetTrick`, `judgeRuleSetTrick`, `resolveDispute` |
| `games.turns.ts` | `forfeitExpiredTurn`, client-side rate limits |
| `games.subscriptions.ts` | `subscribeToGame`, `subscribeToMyGames`, `fetchPlayerCompletedGames` |
| `disputes.raise.ts` | `raiseDispute` (pendingReview → communityReview) |
| `dispute.resolution.shared.ts` | verdict classification + game/stat deltas, shared with the cron |

---

## Client-Side Navigation States

`GameContext` (`src/context/GameContext.tsx`) maps game data into navigation
screens. Not part of the Firestore state machine.

| Condition                            | Screen      |
| ------------------------------------ | ----------- |
| Not authenticated                    | `landing`   |
| Authenticated, no profile            | `profile`   |
| Authenticated + profile              | `lobby`     |
| User taps "Challenge"                | `challenge` |
| User opens active game               | `game`      |
| Game status becomes complete/forfeit | `gameover`  |

---

## Invariants

1. `p1Letters` and `p2Letters` are in range `[0, 5]`
2. Letters never decrease
3. Only one player gains a letter per turn
4. `winner` is null while `status === "active"`
5. `winner` is non-null when `status` is `"complete"` or `"forfeit"`
6. `currentSetter` equals `currentTurn` during the `setting` phase
7. `turnNumber` increases monotonically (starts at 1)
8. **`turnNumber`, `currentSetter` and both letter counts never change while
   `phase` is `pendingReview` or `communityReview`**
9. All client state transitions happen inside Firestore transactions

---

## Deadlines

Two distinct 24-hour fields, both derived from `TURN_DURATION_MS`
(`src/services/turnDuration.ts:10`). Do not conflate them.

| Field            | Applies to                              | Expiry handled by             |
| ---------------- | --------------------------------------- | ----------------------------- |
| `turnDeadline`   | `setting`, `matching`, `setReview`, `disputable` | client on open, **and** `sweep-expired-turns` cron (15 min) |
| `reviewDeadline` | `pendingReview`, `communityReview`       | `resolve-expired-disputes` cron **only** (15 min) |

Firestore rules independently validate every expiry-driven write, so a client
cannot fabricate a forfeit or an auto-accept.

> Both crons are scheduled by GitHub Actions, not Vercel — the Hobby plan caps
> `vercel.json` crons at once per day. `schedule:` triggers are best-effort, so
> a sweep can run late under GitHub platform load.

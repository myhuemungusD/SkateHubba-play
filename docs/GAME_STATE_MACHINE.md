# Game State Machine

This document formalizes the implicit state machine that governs every game
of S.K.A.T.E. in SkateHubba. The source of truth lives in the Firestore
`games` collection; transitions happen inside atomic Firestore transactions
in the `games.*` service modules.

> **Where the code lives.** `src/services/games.ts` is a barrel re-export. The
> implementations are split across `games.create.ts` (createGame),
> `games.match.ts` (setTrick, submitMatchAttempt), `games.judge.ts` (judge
> invites, resolveDispute, callBSOnSetTrick, judgeRuleSetTrick),
> `games.turns.ts` (forfeitExpiredTurn, `TURN_DURATION_MS`),
> `games.mappers.ts`, and `games.subscriptions.ts`. The **File:** lines below
> name `games.ts` because that is the import path callers use.

---

## States

| `status`   | `phase`           | Description                                                                                             |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `active`   | `setting`         | Current setter must name & record a trick                                                               |
| `active`   | `matching`        | Matcher must attempt the trick (or "Call BS" on the set, if a judge is active)                          |
| `active`   | `setReview`       | Judge reviews the setter's video after a "Call BS" from the matcher (judge-only)                        |
| `active`   | `disputable`      | Judge reviews matcher's "landed" claim (judge-only — honor games skip this entirely)                    |
| `active`   | `pendingReview`   | Honor-only. Matcher claimed landed; the **setter** has 24 h to accept or dispute. **Freezes the game**  |
| `active`   | `communityReview` | Honor-only. The setter disputed; the **community** has 24 h to vote `land`/`bail`. **Freezes the game** |
| `complete` | —                 | A player reached 5 letters; winner is recorded                                                          |
| `forfeit`  | —                 | Turn timer expired; opponent wins automatically                                                         |

The two paths are mutually exclusive. A judge-active game uses `setReview` /
`disputable` and never enters `pendingReview` / `communityReview`; an
honor-system game does the reverse.

### Frozen phases

`pendingReview` and `communityReview` **freeze** the game. While frozen:

- `currentSetter`, `currentTurn`, `turnNumber`, letters, and `turnHistory` are all pinned — no `firestore.rules` update branch matches an ordinary turn write.
- The clock runs on **`reviewDeadline`**, not `turnDeadline`. This is deliberate: `api/cron/sweep-expired-turns.ts` skips frozen games entirely (`turnForfeit.shared.ts` returns `null` for both phases), and `api/cron/resolve-expired-disputes.ts` closes them out instead.
- `reviewFor` names the claimer under review (the honor-system mirror of `judgeReviewFor`).
- Letters, the role swap, the landed clip, and the "Trick Landed" notification are all **deferred** until the claim resolves — a claim that later bails must not leave a landed clip behind.

See [DISPUTE_BINDING_DESIGN.md](DISPUTE_BINDING_DESIGN.md).

### Judge status (game-level, independent of `phase`)

| `judgeStatus` | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `null`        | No judge was nominated — game runs on the honor system                 |
| `pending`     | Judge nominated but hasn't accepted yet — honor-system rules in effect |
| `accepted`    | Judge accepted — `disputable` and `setReview` paths unlock             |
| `declined`    | Judge declined — permanent honor system for this game                  |

`isJudgeActive(game)` returns true only when `judgeStatus === "accepted"`.

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
                 ┌─────────────────┐                               │
                 │ active:matching │                               │
                 └───────┬─────────┘                               │
                         │                                         │
        ┌────────────────┼───────────────────────────┐             │
        │ callBs()       │ submitMatchAttempt()      │             │
        │ (judge only)   │                           │             │
        ▼                │                           │             │
┌────────────────┐       ▼                           ▼             │
│active:setReview│   landed=false                landed=true       │
└───────┬────────┘   letters++ for matcher           │             │
        │            (turn resolves)                 │             │
        │ resolveSetReview()  letters>=5?            │             │
        │ (judge)        ┌────┴────┐                 │             │
        │              YES        NO                 │             │
        │               │          └───►(setter keeps setting)─────┤
        │               ▼                            │             │
        │         ┌──────────┐                       │             │
        │         │ complete │                       │             │
        │         └──────────┘                       │             │
        │                                            │             │
        │       ┌────────────────┬───────────────────┘             │
        │       │ judge active?  │                                 │
        │     NO│                │YES                              │
        │       ▼                ▼                                 │
        │  roles swap     ┌──────────────────────┐                 │
        │  immediately    │ active:disputable    │                 │
        │  (honor system) └───────┬──────────────┘                 │
        │       │                 │ judge reviews (24 h)           │
        │       │                 │ resolveDispute()               │
        │       │           ┌─────┴────────┐                       │
        │       │         accept         dispute                   │
        │       │       (or auto-accept) (judge overrules)         │
        │       │           │              │                       │
        │       │     roles swap     letters++ for matcher         │
        │       │           │              │                       │
        │       │           │       letters>=5?                    │
        │       │           │       ┌──────┴──────┐                │
        │       │           │     YES            NO                │
        │       │           │       │             │                │
        │       │           │       ▼     setter keeps setting     │
        │       │           │ ┌──────────┐        │                │
        │       │           │ │ complete │        │                │
        │       │           │ └──────────┘        │                │
        │       │           │                     │                │
        │       └───────────┴─────────────────────┴────────────────┘
        │  (set re-set / clean rulings route back to setting/matching)
        └────────────────────────────────────────────────────────────


  setting/matching + turnDeadline expired
              │
              │ forfeitExpiredTurn()
              ▼
        ┌──────────┐
        │ forfeit  │
        └──────────┘

  disputable + turnDeadline expired (judge didn't rule)
              │
              │ forfeitExpiredTurn() → auto-accept
              ▼
        back to active:setting (matcher's call stands)

  setReview + turnDeadline expired (judge didn't rule on Call BS)
              │
              │ forfeitExpiredTurn() → set stands
              ▼
        back to active:matching (matcher must attempt)
```

---

## Transitions

### `createGame(challenger, opponent)`

**File:** `src/services/games.ts` — `createGame()`

- **Pre-condition:** Client-side 10 s cooldown; Firestore rules block self-challenge
- **Writes:**
  - `status: "active"`, `phase: "setting"`
  - `currentTurn`: challenger UID, `currentSetter`: challenger UID
  - `turnDeadline`: now + 24 h
  - `turnNumber: 1`, both letter counts at 0
- **Result state:** `active:setting`

### `setTrick(gameId, trickName, videoUrl)`

**File:** `src/services/games.ts` — `setTrick()`

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `phase === "setting"`
- **Writes:**
  - `phase: "matching"`
  - `currentTrickName`, `currentTrickVideoUrl` set
  - `currentTurn` → matcher (opponent of current setter)
  - `turnDeadline` → now + 24 h
- **Result state:** `active:matching`

### `submitMatchAttempt(gameId, matchVideoUrl, landed)`

**File:** `src/services/games.ts` — `submitMatchAttempt()`

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `phase === "matching"`

#### Path A — Matcher claims missed (`landed === false`)

- Matcher gains 1 letter (`p1Letters++` or `p2Letters++`)
- Turn resolves immediately: `phase: "setting"`, `turnNumber++`
- Setter keeps setting (same `currentSetter`)
- If letters === 5: `status: "complete"`, `winner` set
- Turn recorded in `turnHistory`
- **Result state:** `active:setting` or `complete`

#### Path B — Matcher claims landed, no active judge (`landed === true`, honor system)

- Nothing resolves: no letters, no role swap, no `turnHistory` entry, no landed clip
- `phase: "pendingReview"`, `matchVideoUrl` set
- `reviewFor` = matcher, `reviewDeadline` = now + 24 h
- `currentSetter` / `currentTurn` / `turnNumber` / letters stay **pinned** (the game freezes)
- The setter is notified atomically with the freeze that their accept/dispute window is open
- **Result state:** `active:pendingReview`

### `acceptLanded(gameId)` — setter accepts the claim

**File:** `src/services/games.match.ts` _(setter-only, from `pendingReview`)_

- **Pre-conditions:** `status === "active"`, `phase === "pendingReview"`, caller is the frozen setter
- **Writes:** the deferred honor swap — no letters, `currentSetter` → matcher, `phase: "setting"`, `turnNumber++`, landed clip written, `reviewFor` / `reviewDeadline` cleared
- **Result state:** `active:setting`

### `raiseDispute(gameId, …)` — setter disputes the claim

**File:** `src/services/disputes.raise.ts` _(setter-only, from `pendingReview`)_

- **Pre-conditions:** `status === "active"`, `phase === "pendingReview"`, caller is the frozen setter (mirrored by `firestore.rules`, which is the authoritative check)
- **Writes:** creates `disputes/{gameId}_{turnNumber}` and flips `phase: "communityReview"`, opening the 24 h vote window. Roles and letters stay pinned.
- **Result state:** `active:communityReview`

### Community verdict (`api/cron/resolve-expired-disputes.ts`)

Runs every 15 min; the referee is server-side (Admin SDK) so verdicts cannot be
forged by a client.

| Tally at `reviewDeadline` | Outcome                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| Majority `land`           | Claim stands — no letter, roles swap (same as accept)                         |
| Majority `bail`           | Claim overturned — matcher earns one letter, setter keeps setting             |
| Tie                       | Retry — matcher re-attempts the same trick, fresh video, no letter, same turn |
| Zero votes                | Auto-accept — claim stands                                                    |

Quorum is **1 vote**. Every outcome also updates the four public dispute
counters (`tricksDisputed`, `disputesRaised`, `disputesRight`, `disputesWrong`)
on both players' profiles. The same endpoint auto-accepts an expired
`pendingReview` that was never disputed.

#### Path C — Matcher claims landed, judge accepted (`landed === true`, judge active)

- No letters awarded, no turn history recorded yet
- `phase: "disputable"`, `matchVideoUrl` set, `judgeReviewFor` = matcher
- `currentTurn` → `judgeId` (judge reviews — never the setter)
- `turnDeadline` → now + 24 h
- **Result state:** `active:disputable`

### `callBSOnSetTrick(gameId)`

**File:** `src/services/games.ts` — `callBSOnSetTrick()` _(judge-only path)_

- **Pre-conditions:** `status === "active"`, `phase === "matching"`, judge active, caller is matcher
- **Writes:** `phase: "setReview"`, `currentTurn` → `judgeId`, `judgeReviewFor` = setter, fresh deadline
- **Result state:** `active:setReview`

### `judgeRuleSetTrick(gameId, clean)`

**File:** `src/services/games.ts` — `judgeRuleSetTrick()` _(judge-only)_

- **Pre-conditions:** `status === "active"`, `phase === "setReview"`, caller is `judgeId`
- **Path A — clean (`clean === true`):** matcher must attempt → `phase: "matching"`, `currentTurn` → matcher
- **Path B — sketchy (`clean === false`):** setter must re-set → `phase: "setting"`, `currentTurn` → setter, set video cleared

### `resolveDispute(gameId, accept)`

**File:** `src/services/games.ts` — `resolveDispute()` _(judge-only)_

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `phase === "disputable"`
  - Caller is the `judgeId` (the setter never self-judges — that was the point of inviting a third party)

#### Path A — Accept (`accept === true`)

- No letters awarded
- `currentSetter` → matcher (roles swap — they landed, so they set next)
- `phase: "setting"`, `turnNumber++`
- Turn recorded in `turnHistory` with `landed: true`, `judgedBy: judgeId`
- **Result state:** `active:setting`

#### Path B — Dispute, no game over (`accept === false`, letters < 5)

- Matcher gains 1 letter (judge overrules the "landed" claim)
- `currentSetter` stays the same (setter keeps setting)
- `phase: "setting"`, `turnNumber++`
- Turn recorded in `turnHistory` with `landed: false`, `judgedBy: judgeId`
- **Result state:** `active:setting`

#### Path C — Dispute, game over (`accept === false`, letters === 5)

- Matcher gains the 5th letter
- `status: "complete"`, `winner` = opponent of the player with 5 letters
- **Result state:** `complete`

### `acceptJudgeInvite(gameId)` / `declineJudgeInvite(gameId)`

**File:** `src/services/games.ts`

- Pre-condition: caller is `judgeId`, `judgeStatus === "pending"`
- Accept → `judgeStatus: "accepted"` (unlocks dispute + Call BS paths)
- Decline → `judgeStatus: "declined"` (permanent honor system; `judgeId` preserved for history)

### `forfeitExpiredTurn(gameId)`

**File:** `src/services/games.ts` — `forfeitExpiredTurn()`

#### Setting / matching phase expired

- **Pre-conditions:** `status === "active"`, `phase` is `"setting"` or `"matching"`, deadline passed
- **Writes:** `status: "forfeit"`, `winner` = opponent of `currentTurn`
- **Result state:** `forfeit`

#### Disputable phase expired (judge didn't rule → auto-accept)

- **Pre-conditions:** `status === "active"`, `phase === "disputable"`, deadline passed
- **Writes:** matcher's "landed" call stands (no letters, roles swap), `phase: "setting"`, `turnNumber++`
- Turn recorded in `turnHistory` with `landed: true`
- **Result state:** `active:setting`

#### setReview phase expired (judge didn't rule on Call BS → set stands)

- **Pre-conditions:** `status === "active"`, `phase === "setReview"`, deadline passed
- **Writes:** matcher must attempt — `phase: "matching"`, `currentTurn` → matcher, fresh deadline
- **Result state:** `active:matching` (benefit of the doubt to the setter)

**Triggers:** (1) client-side, on game-screen mount when the deadline has
passed; (2) server-side, by `api/cron/sweep-expired-turns.ts` every 15 minutes
(`.github/workflows/sweep-expired-turns.yml`, authenticated with
`CRON_SECRET`). Both paths run the same `decideExpiredForfeit` helper in
`src/services/turnForfeit.shared.ts`, so they cannot diverge — the sweep only
writes transitions a client could legally have written itself. Expired
community disputes are closed out on the same cadence by
`api/cron/resolve-expired-disputes.ts`.

---

## Client-Side Navigation States

The `GameContext` (`src/context/GameContext.tsx`) maps game data into
navigation screens. This is not part of the Firestore state machine but
governs what the user sees:

```
Screen flow:
  landing → auth → profile → lobby → challenge → game → gameover
                                 ↑                         │
                                 └─────────────────────────┘

  From lobby, the bottom tab bar also reaches:
    map → spot detail → challenge (?spot=)
    settings · my-stats · player profiles · admin (admin claim only)
```

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

These are always true for a valid game document:

1. `p1Letters` and `p2Letters` are in range `[0, 5]`
2. Letters never decrease
3. Only one player gains a letter per turn
4. `winner` is null while `status === "active"`
5. `winner` is non-null when `status` is `"complete"` or `"forfeit"`
6. `currentSetter` always equals `currentTurn` during the `setting` phase
7. `turnNumber` increases monotonically (starts at 1)
8. All state transitions happen inside Firestore transactions (no partial updates)
9. `reviewFor` and `reviewDeadline` are non-null exactly while `phase` is `pendingReview` or `communityReview`, and are server-cleared when the review resolves
10. A game is never in a judge phase (`setReview` / `disputable`) and an honor phase (`pendingReview` / `communityReview`) — the two paths are mutually exclusive

---

## Turn Deadline

- Duration: 24 hours (`TURN_DURATION_MS`)
- Reset on every phase transition (setTrick / submitMatchAttempt / resolveDispute)
- Enforced on two paths: `forfeitExpiredTurn()` when any player opens a game
  whose deadline has passed, and the 15-minute server sweep
  (`api/cron/sweep-expired-turns.ts`) for games nobody opens
- For setting/matching: expired deadline → forfeit (opponent wins)
- For disputable: expired deadline → auto-accept (matcher's call stands, game continues)
- For `pendingReview` / `communityReview`: `turnDeadline` is **not** the clock —
  these phases run on `reviewDeadline` and are closed out by
  `api/cron/resolve-expired-disputes.ts`, never by the turn-forfeit path
- Firestore security rules prevent fraudulent forfeit and auto-accept claims

# Game State Machine

This document formalizes the implicit state machine that governs every game
of S.K.A.T.E. in SkateHubba. The source of truth lives in the Firestore
`games` collection; transitions happen inside atomic Firestore transactions
in `src/services/games.ts`.

---

## States

| `status`   | `phase`      | Description                                           |
| ---------- | ------------ | ----------------------------------------------------- |
| `active`   | `setting`    | Current setter must name & record a trick             |
| `active`   | `matching`   | Matcher must attempt the trick                        |
| `active`   | `disputable` | Setter reviews matcher's "landed" claim (24 h window) |
| `complete` | —            | A player reached 5 letters; winner is recorded        |
| `forfeit`  | —            | Turn timer expired; opponent wins automatically       |

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
                         │ submitMatchAttempt()                    │
              ┌──────────┴──────────┐                              │
              │                     │                              │
       landed=false           landed=true                          │
              │                     │                              │
   letters++ for matcher            ▼                              │
              │          ┌──────────────────────┐                  │
       letters >= 5?     │ active:disputable    │                  │
       ┌──────┴──────┐   └───────┬──────────────┘                  │
       │             │           │                                 │
    YES             NO    setter reviews (24 h)                    │
       │             │    resolveDispute()                         │
       ▼             │    ┌──────┴──────────┐                      │
 ┌──────────┐        │    │                 │                      │
 │ complete │        │  accept           dispute                   │
 └──────────┘        │  (or auto-accept  (setter overrules)        │
                     │   after 24 h)          │                    │
                     │    │          letters++ for matcher          │
                     │    │                   │                    │
                     │    │           letters >= 5?                │
                     │    │           ┌───────┴───────┐            │
                     │    │        YES               NO            │
                     │    │           │               │            │
                     │    │           ▼        setter keeps        │
                     │    │     ┌──────────┐   setting             │
                     │    │     │ complete │        │              │
                     │    │     └──────────┘        │              │
                     │    │                         │              │
                     │    │  roles swap             │              │
                     │    │  (matcher → setter)     │              │
                     │    └─────────────────────────┘──────────────┘
                     │                                             │
                     │   setter keeps setting                      │
                     └─────────────────────────────────────────────┘


  setting/matching + turnDeadline expired
              │
              │ forfeitExpiredTurn()
              ▼
        ┌──────────┐
        │ forfeit  │
        └──────────┘

  disputable + turnDeadline expired
              │
              │ forfeitExpiredTurn() → auto-accept
              ▼
        back to active:setting (matcher's call stands)
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

#### Path B — Matcher claims landed (`landed === true`)

- No letters awarded, no turn history recorded yet
- `phase: "disputable"`, `matchVideoUrl` set
- `currentTurn` → setter (setter reviews the claim)
- `turnDeadline` → now + 24 h
- **Result state:** `active:disputable`

### `resolveDispute(gameId, accept)`

**File:** `src/services/games.ts` — `resolveDispute()`

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `phase === "disputable"`
  - Caller is `currentTurn` (the setter reviewing the claim)

#### Path A — Accept (`accept === true`)

- No letters awarded
- `currentSetter` → matcher (roles swap — they landed, so they set next)
- `phase: "setting"`, `turnNumber++`
- Turn recorded in `turnHistory` with `landed: true`
- **Result state:** `active:setting`

#### Path B — Dispute, no game over (`accept === false`, letters < 5)

- Matcher gains 1 letter (setter overrules the "landed" claim)
- `currentSetter` stays the same (setter keeps setting)
- `phase: "setting"`, `turnNumber++`
- Turn recorded in `turnHistory` with `landed: false`
- **Result state:** `active:setting`

#### Path C — Dispute, game over (`accept === false`, letters === 5)

- Matcher gains the 5th letter
- `status: "complete"`, `winner` = opponent of the player with 5 letters
- **Result state:** `complete`

### `forfeitExpiredTurn(gameId)`

**File:** `src/services/games.ts` — `forfeitExpiredTurn()`

#### Setting / matching phase expired

- **Pre-conditions:** `status === "active"`, `phase` is `"setting"` or `"matching"`, deadline passed
- **Writes:** `status: "forfeit"`, `winner` = opponent of `currentTurn`
- **Result state:** `forfeit`

#### Disputable phase expired (auto-accept)

- **Pre-conditions:** `status === "active"`, `phase === "disputable"`, deadline passed
- **Writes:** matcher's "landed" call stands (no letters, roles swap), `phase: "setting"`, `turnNumber++`
- Turn recorded in `turnHistory` with `landed: true`
- **Result state:** `active:setting`

**Trigger:** Called on game-screen mount when deadline has passed

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

---

## Turn Deadline

- Duration: 24 hours (`TURN_DURATION_MS`)
- Reset on every phase transition (setTrick / submitMatchAttempt / resolveDispute)
- Enforced client-side: `forfeitExpiredTurn()` is called when any player
  opens a game whose deadline has passed
- For setting/matching: expired deadline → forfeit (opponent wins)
- For disputable: expired deadline → auto-accept (matcher's call stands, game continues)
- Firestore security rules prevent fraudulent forfeit and auto-accept claims

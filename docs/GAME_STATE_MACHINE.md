# Game State Machine

This document formalizes the implicit state machine that governs every game
of S.K.A.T.E. in SkateHubba. The source of truth lives in the Firestore
`games` collection; transitions happen inside atomic Firestore transactions
in `src/services/games.ts`.

---

## States

| `status`   | `phase`      | Description                                     |
| ---------- | ------------ | ----------------------------------------------- |
| `active`   | `setting`    | Current setter must name & record a trick       |
| `active`   | `matching`   | Matcher must attempt the trick                  |
| `active`   | `confirming` | Setter reviews attempt & decides landed/missed  |
| `complete` | —            | A player reached 5 letters; winner is recorded  |
| `forfeit`  | —            | Turn timer expired; opponent wins automatically |

---

## State Diagram

```
                       createGame()
                           │
                           ▼
                  ┌────────────────┐
                  │ active:setting │◄──────────────────────┐
                  └───────┬────────┘                       │
                          │ setTrick()                     │
                          ▼                                │
                 ┌─────────────────┐                       │
                 │ active:matching │                       │
                 └───────┬─────────┘                       │
                         │ submitMatchAttempt()            │
                         ▼                                 │
               ┌───────────────────┐                       │
               │ active:confirming │                       │
               └───────┬───────────┘                       │
                       │                                   │
           submitConfirmation()                            │
           (setter decides)                                │
              ┌────────┴──────────┐                        │
              │                   │                        │
         landed=true         landed=false                  │
              │                   │                        │
              │            letters++ for matcher           │
              │                   │                        │
              │            letters >= 5?                    │
              │            ┌──────┴──────┐                 │
              │            │             │                 │
              │         YES             NO                 │
              │            │             │                 │
              │            ▼             │                 │
              │      ┌──────────┐        │                 │
              │      │ complete │        │                 │
              │      └──────────┘        │                 │
              │                          │                 │
              │   next setter = current  │                 │
              │   setter (same player)   │                 │
              │            │             │                 │
              │            └─────────────┘                 │
              │                                            │
              │   next setter = matcher (roles swap)       │
              └────────────────────────────────────────────┘


  Any active state + turnDeadline expired
              │
              │ forfeitExpiredTurn()
              ▼
        ┌──────────┐
        │ forfeit  │
        └──────────┘
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

### `submitMatchAttempt(gameId, matchVideoUrl)`

**File:** `src/services/games.ts` — `submitMatchAttempt()`

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `phase === "matching"`
- **Writes:**
  - `phase: "confirming"`
  - `matchVideoUrl` set
  - `currentTurn` → setter (setter reviews the attempt)
  - `turnDeadline` → now + 24 h
- **Result state:** `active:confirming`

### `submitConfirmation(gameId, playerUid, landed)`

**File:** `src/services/games.ts` — `submitConfirmation()`

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `phase === "confirming"`
  - `playerUid === currentSetter` (only the setter can decide)

#### Path A — Landed (`landed === true`)

- No letters awarded
- `currentSetter` → matcher (roles swap)
- `phase: "setting"`, `turnNumber++`
- **Result state:** `active:setting`

#### Path B — Missed, no game over (`landed === false`, letters < 5)

- Matcher gains 1 letter (`p1Letters++` or `p2Letters++`)
- `currentSetter` stays the same (setter keeps setting)
- `phase: "setting"`, `turnNumber++`
- **Result state:** `active:setting`

#### Path C — Missed, game over (`landed === false`, letters === 5)

- Matcher gains the 5th letter
- `status: "complete"`, `winner` = opponent of the player with 5 letters
- **Result state:** `complete`

### `forfeitExpiredTurn(gameId)`

**File:** `src/services/games.ts` — `forfeitExpiredTurn()`

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `turnDeadline.toMillis() < Date.now()`
- **Writes:**
  - `status: "forfeit"`
  - `winner` = opponent of `currentTurn` player
- **Result state:** `forfeit`
- **Trigger:** Called on game-screen mount when deadline has passed

---

## Client-Side Navigation States

`App.tsx` uses `react-router-dom` v7 for URL routing, with
`NavigationContext` (`src/context/NavigationContext.tsx`) bridging the
logical screen names to router paths. The `GameContext`
(`src/context/GameContext.tsx`) still owns game data and fires
`nav.setScreen(...)` when a state transition should drive navigation.

```
Route flow:
  /  →  /auth  →  /profile  →  /lobby  →  /challenge  →  /game  →  /gameover
                                    ↑                                │
                                    └────────────────────────────────┘
```

| Condition                            | Path           | Screen name |
| ------------------------------------ | -------------- | ----------- |
| Not authenticated                    | `/`            | `landing`   |
| Authenticated, no profile            | `/profile`     | `profile`   |
| Authenticated + profile              | `/lobby`       | `lobby`     |
| User taps "Challenge"                | `/challenge`   | `challenge` |
| User opens active game               | `/game`        | `game`      |
| Game status becomes complete/forfeit | `/gameover`    | `gameover`  |

Public pages (`/privacy`, `/terms`, `/data-deletion`, `/map`,
`/spots/:id`, `/player/:uid`) are deep-linkable without authentication.

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
- Reset on every phase transition (setTrick / submitMatchAttempt / submitConfirmation)
- Enforced on **two independent paths**:
  1. **Client-triggered:** `forfeitExpiredTurn()` runs when either player opens a game whose deadline has passed.
  2. **Server-scheduled:** the `checkExpiredTurns` Cloud Function runs every 15 minutes, queries for active games with expired `turnDeadline`, and auto-forfeits them — so an offline player can't dodge a loss by never re-opening the app.
- Firestore security rules validate every forfeit write (`request.time > resource.data.turnDeadline` and winner must be the opponent of the timed-out player), so neither path can be used to forge a forfeit.

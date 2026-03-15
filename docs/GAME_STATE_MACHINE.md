# Game State Machine

This document formalizes the implicit state machine that governs every game
of S.K.A.T.E. in SkateHubba. The source of truth lives in the Firestore
`games` collection; transitions happen inside atomic Firestore transactions
in `src/services/games.ts`.

---

## States

| `status`   | `phase`    | Description                                     |
| ---------- | ---------- | ----------------------------------------------- |
| `active`   | `setting`  | Current setter must name & record a trick       |
| `active`   | `matching` | Matcher must attempt the trick & self-judge     |
| `complete` | —          | A player reached 5 letters; winner is recorded  |
| `forfeit`  | —          | Turn timer expired; opponent wins automatically |

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
                         │                                 │
           submitMatchResult()                             │
              ┌──────────┴──────────┐                      │
              │                     │                      │
         landed=true           landed=false                │
              │                     │                      │
              │              letters++ for matcher         │
              │                     │                      │
              │              letters >= 5?                  │
              │              ┌──────┴──────┐               │
              │              │             │               │
              │           YES             NO               │
              │              │             │               │
              │              ▼             │               │
              │        ┌──────────┐        │               │
              │        │ complete │        │               │
              │        └──────────┘        │               │
              │                            │               │
              │   next setter = current    │               │
              │   setter (same player)     │               │
              │              │             │               │
              │              └─────────────┘               │
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

### `submitMatchResult(gameId, landed, matchVideoUrl)`

**File:** `src/services/games.ts` — `submitMatchResult()`

- **Pre-conditions (validated inside transaction):**
  - `status === "active"`
  - `phase === "matching"`

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
- Reset on every phase transition (setTrick / submitMatchResult)
- Enforced client-side: `forfeitExpiredTurn()` is called when any player
  opens a game whose deadline has passed
- Firestore security rules prevent fraudulent forfeit claims

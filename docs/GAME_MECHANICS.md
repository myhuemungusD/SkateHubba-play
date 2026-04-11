# Game Mechanics

## What is S.K.A.T.E.?

S.K.A.T.E. is the skateboarding equivalent of HORSE. Two players compete turn by turn. One player sets a trick; the other must land it. Miss and you earn a letter — S, then K, then A, then T, then E. First to spell it out loses.

This app brings that format to mobile, async. You set your trick whenever you want, your opponent matches whenever they want. No need to be at the same skatepark or online at the same time.

---

## Player Setup

**Username:**

- 3–20 characters, lowercase letters, numbers, and underscores only (`[a-z0-9_]+`)
- Normalized to lowercase at the service boundary (input is case-insensitive)
- Permanently reserved — usernames cannot be changed or deleted after creation

**Stance:** Regular (left foot forward) or Goofy (right foot forward). Stored for display only; has no effect on game logic.

---

## Starting a Game

Any player can challenge any other player by typing their username in the challenge screen. Self-challenges are blocked both client-side and by Firestore rules. The player who sends the challenge becomes Player 1 and sets the first trick.

---

## Turn Structure

Each turn has two phases: **setting** and **matching**.

### Phase 1 — Setting

The current setter must:

1. Type the trick name (max 100 characters, trimmed of whitespace)
2. Record a one-take video using the device camera — WebM via `MediaRecorder` on the web build, or MP4 via the native camera on the Capacitor iOS/Android shells
3. Submit

On submit (`setTrick`):

- The game transitions to `phase: "matching"`
- `currentTurn` switches to the matcher (the other player)
- A fresh 24-hour deadline starts for the matcher

### Phase 2 — Matching

The matcher must:

1. Watch the setter's video
2. Record their own one-take attempt
3. Submit their attempt for review

On submit (`submitMatchAttempt`), the game transitions to the **confirming** phase and it becomes the setter's turn to review.

### Phase 3 — Confirming

The setter reviews both videos and decides whether the matcher landed the trick. Only the setter votes — the matcher waits for the decision.

On submit (`submitConfirmation`):

| Result | Letter assigned          | Next setter                                 |
| ------ | ------------------------ | ------------------------------------------- |
| Landed | None                     | Matcher becomes the new setter (roles swap) |
| Missed | Matcher earns one letter | Setter keeps setting                        |

The `turnNumber` increments after every completed trick round (one full set → match → confirm cycle).

---

## Letter Counting

Letters accumulate as integers stored in `p1Letters` and `p2Letters` (0–5).

```
0 letters = no penalty
1 letter  = S
2 letters = S.K.
3 letters = S.K.A.
4 letters = S.K.A.T.
5 letters = S.K.A.T.E. → loss
```

Letters never decrease and only one player can gain a letter per turn. Both constraints are enforced by Firestore rules.

---

## Game End Conditions

### Normal completion (`status: "complete"`)

A player reaches 5 letters. The player who did **not** reach 5 letters is the winner. This is determined inside the `submitMatchResult` transaction and immediately stored in the game document.

### Forfeit (`status: "forfeit"`)

A player does not submit their turn within 24 hours of the `turnDeadline`. Either player can trigger this by opening the game after the deadline passes — the app calls `forfeitExpiredTurn` on game open, which checks the deadline server-side in a transaction. The winner is the opponent of the player whose turn it was. Letters do not change on a forfeit — the game ends immediately regardless of score.

---

## 24-Hour Turn Timer

- Every time a phase transitions (setting → matching or matching → setting), a new `turnDeadline` Timestamp is written to the game document: `Date.now() + 24 hours`.
- The countdown is displayed in the game screen as `HH:MM:SS`.
- Enforcement runs on two paths:
  - **Client-triggered:** when either player opens a game where `turnDeadline < Date.now()`, the app calls `forfeitExpiredTurn`.
  - **Server-scheduled:** the `checkExpiredTurns` Cloud Function (`functions/src/index.ts`) runs every 15 minutes and forfeits any active game whose deadline has expired — so a player who never reopens the app can no longer dodge a loss.
- The Firestore rules validate every forfeit write (`request.time > resource.data.turnDeadline` and the winner must be the opponent of the timed-out player), so neither path can be used to forge a forfeit.

---

## Video Recording

- One take only. The camera starts recording immediately when the player taps "Record." There is no re-record option before submission.
- Format: `video/webm` on the web build (via `MediaRecorder`) or `video/mp4` on the Capacitor iOS/Android shells (via the native camera).
- Storage path: `games/{gameId}/turn-{turnNumber}/{role}.{webm|mp4}` where `role` is `"set"` (setter's trick) or `"match"` (matcher's attempt). The storage rules regex `(set|match)\.(webm|mp4)` enforces the allowlist.
- Size limits: 1 KB minimum (prevents empty uploads), 50 MB maximum per video.
- Videos are stored permanently — there is no cleanup process in the current version.

---

## Real-Time Updates

Both players see game state changes the moment they happen. Firestore `onSnapshot` listeners update the game screen and lobby without any manual refresh. When your opponent submits their turn, your screen transitions automatically.

---

## Rematch

From the game-over screen, either player can start a rematch. A rematch creates a new game document with the same two players. The player who initiates the rematch becomes Player 1 and sets the first trick.

---

## Setter's Call

The setter has the final say on whether a trick was landed. After the matcher submits their attempt, the setter reviews both videos and decides. There is no opponent voting — this keeps the game flow fast and avoids delays waiting for both players to vote. Videos are stored and visible to both players for transparency.

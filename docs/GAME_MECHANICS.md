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
2. Record a one-take video using the device camera (WebM format via MediaRecorder API)
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

On submit (`submitMatchAttempt`):

- **Missed:** The matcher admits they missed. A letter is assigned immediately. The setter keeps setting. Turn resolves instantly.
- **Landed (honor system, no judge):** Roles swap immediately. No letter, no review step, no `disputable` phase.
- **Landed (judge accepted):** The game enters the **disputable** phase. The judge — never the setter — has 24 h to rule.

### Phase 3 — Disputable (judge reviews "landed" claim) _— only with an active judge_

When the matcher claims "landed" and an accepted judge is on the game, the **judge** (not the setter) has 24 hours to review both videos and decide whether to accept or dispute. Honor-system games skip this phase entirely.

On submit (`resolveDispute`, judge-only):

| Result  | Letter assigned          | Next setter                                 |
| ------- | ------------------------ | ------------------------------------------- |
| Accept  | None                     | Matcher becomes the new setter (roles swap) |
| Dispute | Matcher earns one letter | Setter keeps setting                        |

If the judge does not rule within 24 hours, the matcher's "landed" call is **auto-accepted** — no letter is assigned and roles swap. This keeps the game loop moving; a stalled game is worse than an occasionally wrong call.

The `turnNumber` increments after every completed trick round (one full set → match → [optional review] cycle).

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
- Enforcement is client-triggered: when either player opens a game where `turnDeadline < Date.now()`, the app calls `forfeitExpiredTurn`. A player who never opens the app will not be auto-forfeited until their opponent checks.
- The Firestore rules validate the forfeit write — a client cannot claim a forfeit unless the current player's turn has genuinely expired.

---

## Video Recording

- One take only. The camera starts recording immediately when the player taps "Record." There is no re-record option before submission.
- Format: `video/webm` (via MediaRecorder API).
- Storage path: `games/{gameId}/turn-{turnNumber}/{role}.webm` where `role` is `"set"` (setter's trick) or `"match"` (matcher's attempt).
- Size limits: 1 KB minimum (prevents empty uploads), 50 MB maximum per video.
- Videos are stored permanently — there is no cleanup process in the current version.

---

## Real-Time Updates

Both players see game state changes the moment they happen. Firestore `onSnapshot` listeners update the game screen and lobby without any manual refresh. When your opponent submits their turn, your screen transitions automatically.

---

## Rematch

From the game-over screen, either player can start a rematch. A rematch creates a new game document with the same two players. The player who initiates the rematch becomes Player 1 and sets the first trick.

---

## Dispute System

The matcher self-judges whether they landed the trick. If the matcher claims "missed", the letter is assigned immediately and no review is needed. What happens on a claimed "landed" depends on whether the game has a judge:

### Honor system (default — no judge)

If no judge is nominated, or if a nominated judge declined the invite, a "landed" claim **immediately swaps roles**. No review, no waiting, no letter. This is the new default behaviour — most games never enter a `disputable` phase.

### With an active judge

When the challenger nominated a third player as judge and that judge accepted the invite, a claimed "landed" routes to the judge — never to the setter — for a 24-hour review:

- **Accept**: the judge confirms the trick was landed. No letter, matcher becomes the next setter.
- **Dispute**: the judge overrules the claim. The matcher earns a letter, setter keeps setting.
- **No response (24 h)**: auto-accept. The matcher's "landed" call stands. This prevents stalled games.

### "Call BS" on a set trick (judge-only)

Before attempting, the matcher can flag the setter's video for judge review (`setReview` phase). The judge rules:

- **Clean**: matcher must attempt the trick.
- **Sketchy**: setter has to re-set.
- **No response (24 h)**: set stands (benefit of the doubt to the setter).

Both players see a "Judge Pending / Judge / No Judge" badge so they always know which resolution path is live. Videos remain stored and visible to both players (and the judge) for transparency.

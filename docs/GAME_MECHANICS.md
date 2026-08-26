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
2. Record a one-take video using the device camera (WebM via MediaRecorder on web, MP4 via Capacitor on native)
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
- **Landed (honor system, no judge):** The game **freezes** into the `pendingReview` phase. Nothing swaps yet — the setter has 24 h to accept the claim or dispute it. See Phase 3a.
- **Landed (judge accepted):** The game enters the **disputable** phase. The judge — never the setter — has 24 h to rule.

### Phase 3a — Pending Review (setter reviews "landed" claim) _— honor system, the default_

With no active judge, a "landed" claim does **not** resolve the turn. `submitMatchAttempt` writes `phase: "pendingReview"` and a 24-hour `reviewDeadline`, and leaves `currentSetter`, `turnNumber`, and both letter counts untouched. The game is frozen: neither player can advance it, and it cannot be forfeited for inactivity.

The **setter** — the player whose trick was matched — then has 24 hours to decide:

| Setter's action                | Letter assigned          | Next state                                              |
| ------------------------------ | ------------------------ | -------------------------------------------------------- |
| Accept (`acceptLanded`)        | None                     | Roles swap, `turnNumber++` — matcher becomes the setter  |
| Dispute (`raiseDispute`)       | None yet                 | `communityReview` — the community votes (Phase 3b)       |
| No response (24 h)             | None                     | Auto-accept by cron — the claim stands, roles swap       |

Only the setter can resolve it (`firestore.rules:1459-1464`); the matcher cannot accept their own claim. The landed clip and the "Trick Landed" notification are deliberately held back until acceptance — a claim is not a landing yet.

### Phase 3b — Community Review (the trick goes to a public vote)

When the setter disputes, a `disputes/{gameId}_{turnNumber}` document opens and the matched trick is posted to the community feed for a **LAND / BAIL** vote with a 24-hour window. The game stays frozen throughout.

No client can move a game out of `communityReview` — there is no rule permitting it. Only the server referee (`api/cron/resolve-expired-disputes.ts`, every 15 minutes) resolves it, once the vote window closes. Quorum is one vote:

| Verdict | Condition               | Outcome                                                        |
| ------- | ----------------------- | -------------------------------------------------------------- |
| LAND    | more land than bail     | Claim stands — roles swap                                      |
| BAIL    | more bail than land     | Matcher earns a letter; setter keeps setting                   |
| Tie     | equal, both non-zero    | Retry — the matcher re-attempts (back to `matching`)           |
| No votes| nobody voted            | Auto-accept — the claim stands                                 |

Disputing is not free: the outcome increments `disputesRight` or `disputesWrong` on the disputer's public stats.

### Phase 3c — Disputable (judge reviews "landed" claim) _— only with an active judge_

When the matcher claims "landed" and an accepted judge is on the game, the **judge** (not the setter) has 24 hours to review both videos and decide whether to accept or dispute. Honor-system games skip this phase entirely.

On submit (`resolveDispute`, judge-only):

| Result  | Letter assigned          | Next setter                                 |
| ------- | ------------------------ | ------------------------------------------- |
| Accept  | None                     | Matcher becomes the new setter (roles swap) |
| Dispute | Matcher earns one letter | Setter keeps setting                        |

If the judge does not rule within 24 hours, the matcher's "landed" call is **auto-accepted** — no letter is assigned and roles swap. This keeps the game loop moving; a stalled game is worse than an occasionally wrong call.

The `turnNumber` increments only when a trick round actually completes. It does **not** advance while a game sits in `pendingReview` or `communityReview`.

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

A player reaches 5 letters. The player who did **not** reach 5 letters is the winner. This is determined inside the `submitMatchAttempt` transaction and immediately stored in the game document.

### Forfeit (`status: "forfeit"`)

A player does not submit their turn within 24 hours of the `turnDeadline`. Two independent paths apply it: either player opening the game after the deadline (`forfeitExpiredTurn`), **and** a server-side sweep (`api/cron/sweep-expired-turns.ts`) that runs every 15 minutes regardless of whether anyone opens the app. Both compute the outcome through the same shared helper, so they cannot diverge. The winner is the opponent of the player whose turn it was. Letters do not change on a forfeit.

Games frozen in `pendingReview` or `communityReview` are **never** forfeited for inactivity — the sweep skips them by design.

---

## 24-Hour Turn Timer

- Every time a phase transitions (setting → matching or matching → setting), a new `turnDeadline` Timestamp is written to the game document: `Date.now() + 24 hours`.
- The countdown is displayed in the game screen as `HH:MM:SS`.
- Enforcement is both client- and server-triggered. Opening a game past its deadline calls `forfeitExpiredTurn`; independently, `api/cron/sweep-expired-turns.ts` sweeps expired turns every 15 minutes. Declining to open the app delays a forfeit by at most one sweep, it does not avoid one.
- `reviewDeadline` is a **separate** 24-hour field covering `pendingReview` and `communityReview`. It is resolved only by `api/cron/resolve-expired-disputes.ts`, never by a client.
- The Firestore rules validate the forfeit write — a client cannot claim a forfeit unless the current player's turn has genuinely expired.

---

## Video Recording

- One take only. The camera starts recording immediately when the player taps "Record." There is no re-record option before submission.
- Format: `video/webm` on web (via MediaRecorder API) or `video/mp4` on native (via Capacitor).
- Storage path: `games/{gameId}/turn-{turnNumber}/{role}-{uploaderUid}.{ext}` where `role` is `"set"` (setter's trick) or `"match"` (matcher's attempt) and `{ext}` is `webm` (web) or `mp4` (native). **The uploader's UID is part of the filename** and `storage.rules` matches it by exact string equality, so no account can occupy another player's upload path. The object also carries `uploaderUid` metadata, and `update` is denied outright — an upload slot is write-once.
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

If no judge is nominated, or a nominated judge declined, a "landed" claim freezes the game into `pendingReview` and hands the decision to the **setter** for 24 hours: accept, or send it to a community LAND/BAIL vote (`communityReview`). Silence auto-accepts. Most games never enter the judge-only `disputable` phase — they run through `pendingReview` instead. Full detail in Phases 3a/3b above.

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

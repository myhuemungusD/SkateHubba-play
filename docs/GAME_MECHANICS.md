# Game Mechanics

## What is S.K.A.T.E.?

S.K.A.T.E. is the skateboarding equivalent of HORSE. Two players compete turn by turn. One player sets a trick; the other must land it. Miss and you earn a letter — S, then K, then A, then T, then E. First to spell it out loses.

This app brings that format to mobile, async. You set your trick whenever you want, your opponent matches whenever they want. No need to be at the same skatepark or online at the same time.

---

## Player Setup

**Username:**

- 3–20 characters, lowercase letters, numbers, and underscores only (`[a-z0-9_]+`)
- Normalized to lowercase at the service boundary (input is case-insensitive)
- Reserved for the life of the account — a username cannot be changed once chosen. The reservation in `usernames/{username}` is released only when the account itself is deleted (see the account-deletion cascade in `src/services/users.ts` and `api/account/_deleteUserData.ts`)

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
- **Landed (honor system, no judge):** The game **freezes** into the `pendingReview` phase and the setter gets 24 h to accept or dispute the claim. Nothing resolves yet — no letter, no role swap, no landed clip.
- **Landed (judge accepted):** The game enters the **disputable** phase. The judge — never the setter — has 24 h to rule.

### Phase 3a — Pending review (setter reviews "landed" claim) _— honor-system games_

See [Community disputes](#community-disputes-crowd-verdict) below for the full
`pendingReview` → `communityReview` flow. In short: the claim freezes the game and
the setter has 24 h to accept it or hand the call to the community.

### Phase 3b — Disputable (judge reviews "landed" claim) _— only with an active judge_

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

A player reaches 5 letters. The player who did **not** reach 5 letters is the winner. This is determined inside the `submitMatchAttempt` transaction and immediately stored in the game document.

### Forfeit (`status: "forfeit"`)

A player does not submit their turn within 24 hours of the `turnDeadline`. Either player can trigger this by opening the game after the deadline passes — the app calls `forfeitExpiredTurn` on game open, which checks the deadline server-side in a transaction — and the scheduled sweep (`api/cron/sweep-expired-turns.ts`, every 15 min) applies the same transition unattended. The winner is the opponent of the player whose turn it was. Letters do not change on a forfeit — the game ends immediately regardless of score.

---

## 24-Hour Turn Timer

- Every time a phase transitions (setting → matching or matching → setting), a new `turnDeadline` Timestamp is written to the game document: `Date.now() + 24 hours`.
- The countdown is displayed in the game screen as `HH:MM:SS`.
- Enforcement runs on two paths. **Client-triggered:** when either player opens a game where `turnDeadline < Date.now()`, the app calls `forfeitExpiredTurn`. **Server-triggered:** `api/cron/sweep-expired-turns.ts` runs every 15 minutes (scheduled by `.github/workflows/sweep-expired-turns.yml`, authenticated with `CRON_SECRET`) and applies the same transition to any expired game, so a stalled game resolves even if neither player opens the app.
- Both paths share the same decision helper (`src/services/turnForfeit.shared.ts`), so they cannot diverge — the sweep only ever writes a transition a client could legally have written itself.
- The Firestore rules validate the forfeit write — a client cannot claim a forfeit unless the current player's turn has genuinely expired.

---

## Video Recording

- One take only. The camera starts recording immediately when the player taps "Record." There is no re-record option before submission.
- Format: `video/webm` on web (via MediaRecorder API) or `video/mp4` on native (via Capacitor).
- Storage path: `games/{gameId}/turn-{turnNumber}/{role}-{uploaderUid}.{ext}` where `role` is `"set"` (setter's trick) or `"match"` (matcher's attempt) and `{ext}` is `webm` (web) or `mp4` (native). The uid suffix is enforced by `storage.rules` so no account can occupy another player's upload path.
- Size limits: 1 KB minimum (prevents empty uploads), 50 MB maximum per video.
- Videos are not kept forever. Every upload is stamped with a `retainUntil` metadata hint 90 days out (`src/services/storage.ts`) and a Storage lifecycle rule purges objects past that window. Videos attached to non-active games are also deleted eagerly by the account-deletion cascade (`deleteGameVideos`).

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

If no judge is nominated, or if a nominated judge declined the invite, a "landed" claim goes to the **binding community dispute** flow instead of the judge path. Honor-system games never enter `disputable` or `setReview`.

1. **`pendingReview` — the setter's 24 h window.** The claim freezes the game: `currentSetter`, `currentTurn`, `turnNumber`, letters, and `turnHistory` all stay pinned, and the review clock runs on `reviewDeadline` (separate from `turnDeadline`, so the turn-forfeit sweep skips frozen games). The setter is notified that the window is open.
   - **Accept** (`acceptLanded`) → the claim resolves: no letter, roles swap, the landed clip is written, `turnNumber++`.
   - **No response within 24 h** → **auto-accept**. Same outcome, applied by `api/cron/resolve-expired-disputes.ts`.
   - **Dispute** → the game moves to `communityReview`.
2. **`communityReview` — the crowd's 24 h window.** Any signed-in, email-verified user who is not a participant votes `land` or `bail`. The majority verdict is **binding** on letters, turn order, and the four public dispute counters on both players' profiles.
   - **Quorum is 1** — a single vote decides.
   - **Tie** → retry: the matcher re-attempts the same trick, fresh video, no letter, same turn.
   - **Zero votes at the deadline** → auto-accept the claim.

Letters, role swaps, landed clips, and the "Trick Landed" notification are all **deferred** until the claim resolves — a claim that later bails must not leave a landed clip or a premature notification behind.

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

### Community disputes (crowd verdict)

Separate from the per-game referee, a setter can escalate a matcher's "landed" claim to the **community** rather than to a nominated judge. The dispute lands in the clips feed's dispute lane, where any signed-in, email-verified user who is not a participant votes `land` or `bail`. One vote per user per dispute, enforced by document id (`${uid}_${disputeId}`) in `firestore.rules` — the client's `canVote` flag is a UI affordance, not authorization.

Open disputes that no one resolves are closed out server-side by `api/cron/resolve-expired-disputes.ts` (every 15 minutes). Outcomes feed the `tricksDisputed` / `disputesRaised` / `disputesRight` / `disputesWrong` counters on the player profile.

See [DISPUTE_BINDING_DESIGN.md](DISPUTE_BINDING_DESIGN.md) for the binding rules and [DATABASE.md](DATABASE.md) for the `disputes` / `disputeVotes` schema.

# Binding Community Trick Dispute — Engineering Design

Status: **SHIPPED** — service + rules + referee landed 2026-07-30 (#474, building on #463); the
live vote-tally UI completed it 2026-08-21 (#522). Owner-approved 2026-07. Scope:
**honor-system games only** (the nominated-referee / judge path is unchanged and out of scope here).

This remains the **design of record**, not an archive: it is the only written source for the
frozen-phase state machine and the stat-increment rules, and the referee cron cites its §3.3/§3.4
(`.github/workflows/resolve-expired-disputes.yml`). Kept in `docs/`, deliberately.

This document is the single source of truth every implementation phase builds against. If code and
this doc disagree, fix one of them deliberately — do not let them drift.

---

## 1. Product summary

Today a matcher's "landed" claim is trusted on the honor system and instantly resolves the turn.
This feature lets the opponent **dispute** a landed claim and hand the call to the community, whose
majority vote becomes **binding** on game state (letters, turn order) and on the disputing/claiming
players' **public stats**.

Locked product decisions (owner):

| Decision               | Value                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Who can dispute        | The opponent of the claimer (the setter of that turn). Any landed claim is disputable.                   |
| Accept/dispute window  | **24h**. If the opponent does not dispute within 24h, the claim **auto-accepts** and the game continues. |
| Community vote window  | **24h** after a dispute is raised.                                                                       |
| Quorum                 | **1 vote**. A single vote is enough to decide.                                                           |
| Tie (equal land/bail)  | **Retry** — the matcher re-attempts the same trick (fresh video, no letter, same turn).                  |
| Zero votes at deadline | **Auto-accept** the claim (landed stands, matcher becomes setter).                                       |
| Stats visibility       | **Public** on the profile.                                                                               |
| Stats polarity         | Positive **and** negative recorded.                                                                      |
| App Check              | **Off for now** (see Risk R1).                                                                           |
| Resolver               | A new server-side "dispute referee" (`api/cron`), owner-approved.                                        |

---

## 2. Stats — the four public counters

Written to `users/{uid}` (world-readable), **server-only** (admin SDK), never by the client. They
follow the existing Tier-1 stat pattern: added to `UserProfile`, zero-seeded + immutable in
`firestore.rules`, written exclusively by an admin resolver.

| Field            | Meaning                                                                     | Written to                |
| ---------------- | --------------------------------------------------------------------------- | ------------------------- |
| `tricksDisputed` | # of the user's landed claims that were disputed                            | the **claimer** (matcher) |
| `disputesRaised` | # of disputes the user initiated                                            | the **disputer** (setter) |
| `disputesRight`  | of raised disputes, community sided with the disputer (**bail** verdict)    | the **disputer**          |
| `disputesWrong`  | of raised disputes, community sided against the disputer (**land** verdict) | the **disputer**          |

Increment rules (all applied by the referee, in one admin transaction, at resolution):

- **Any** resolved dispute (land / bail / tie / zero-vote): `tricksDisputed`+1 on claimer,
  `disputesRaised`+1 on disputer. (A dispute occurred, regardless of verdict.)
- **land** verdict additionally: `disputesWrong`+1 on disputer.
- **bail** verdict additionally: `disputesRight`+1 on disputer.
- **tie / zero-vote**: no right/wrong increment.

> RESOLVED BY SHIPPING: a **zero-vote auto-accept** does increment the two raw counts
> (`tricksDisputed`/`disputesRaised`) — a dispute was raised, so it counts. Implemented in
> `src/services/dispute.resolution.shared.ts` and applied by
> `api/cron/resolve-expired-disputes.ts`. Still a one-line flip in the decision helper if the
> owner later wants zero-vote to be fully neutral.

Game win/loss stats remain handled by the existing `applyGameStats` function at game end — untouched.
If a **bail** verdict awards the 5th letter and ends the game, that terminal transition triggers
`applyGameStats` as usual for `wins`/`losses`.

---

## 3. Game state machine changes

### 3.1 New phases (added to `GamePhase` in `src/services/games.mappers.ts`)

- `pendingReview` — a landed claim is awaiting the opponent's accept/dispute decision (24h).
- `communityReview` — a dispute was raised; awaiting the community vote (24h).

Both **freeze the game**: no existing `firestore.rules` update branch matches these phases, so no
setter/matcher/forfeit write is permitted until a dedicated close-out branch fires. This is the
freeze mechanism.

### 3.2 New `games/{id}` fields

- `reviewFor?: string` — the claimer (matcher) uid whose landed claim is under review. Mirrors the
  existing `judgeReviewFor`.
- `reviewDeadline?: Timestamp` — the deadline of the current review phase (accept window in
  `pendingReview`; vote window in `communityReview`). Distinct from `turnDeadline` so the existing
  turn-forfeit sweep never touches a frozen game.

`statsApplied` and letter/turn fields keep their existing immutability pins.

### 3.3 Transitions (honor-system games)

```
matching --submitMatchAttempt(landed=true)--> pendingReview        [FREEZE]
    set: phase=pendingReview, reviewFor=matcherUid, reviewDeadline=now+24h,
         matchVideoUrl=<url>
    UNCHANGED / PINNED: currentSetter, currentTurn, turnNumber, p1Letters, p2Letters,
         turnHistory (no append yet — the turn is NOT resolved)

pendingReview --acceptLanded(by setter) OR reviewDeadline expiry--> setting   [today's honor swap, deferred]
    set: phase=setting, currentSetter=matcherUid, currentTurn=matcherUid,
         turnNumber+1, append landed TurnRecord, turnDeadline=now+24h,
         clear reviewFor/reviewDeadline
    NO letter. (Identical to today's honor landed resolution — just deferred by up to 24h.)

pendingReview --raiseDispute(by setter)--> communityReview          [escalate to crowd]
    set: phase=communityReview, reviewDeadline=now+24h
    create/confirm disputes/{gameId}_{turnNumber} (status=open)
    UNCHANGED / PINNED: roles, turnNumber, letters, turnHistory

communityReview --referee resolution (after reviewDeadline)-->  { see 3.4 }
```

### 3.4 Referee resolution outcomes (from `communityReview`)

Let `matcher` = claimer = `reviewFor`, `setter` = disputer = `currentSetter`.

- **land majority** (claim upheld): honor swap — `phase=setting`, `currentSetter=matcher`,
  `currentTurn=matcher`, `turnNumber+1`, append landed TurnRecord, no letter. Stats:
  claimer `tricksDisputed`+1, disputer `disputesRaised`+1, disputer `disputesWrong`+1.
- **bail majority** (claim overturned): matcher takes one letter.
  - if matcher reaches 5 → `status=complete`, `winner=setter`.
  - else `phase=setting`, `currentSetter` unchanged (setter keeps setting), `currentTurn=setter`,
    `turnNumber+1`, append TurnRecord `landed:false, letterTo:matcher`.
  - Stats: claimer `tricksDisputed`+1, disputer `disputesRaised`+1, disputer `disputesRight`+1.
- **tie** (land == bail, both ≥1): retry — `phase=matching`, `currentSetter` unchanged, matcher
  re-attempts, clear `matchVideoUrl`, `turnDeadline=now+24h`, no letter, no TurnRecord append.
  Stats: claimer `tricksDisputed`+1, disputer `disputesRaised`+1 (no right/wrong).
- **zero votes** (below quorum of 1 at deadline): auto-accept = same game effect as **land**
  (matcher becomes setter, no letter), but **no** right/wrong stat. Raw counts per §2 open nuance.

The letter direction and winner direction reuse the exact pins already enforced for the judge
dispute path (a `+1` bound to the matcher = opponent of `currentSetter`; winner pinned to the
non-5 player).

---

## 4. Dispute doc lifecycle (reuse existing `disputes` / `disputeVotes`)

The existing community-dispute collections and feed UI are reused. Changes:

- `disputes/{gameId}_{turnNumber}` gains a real close-out: `status` transitions `open → closed`.
  **This shipped inverted relative to the plan above** — the client contract standardised on
  `closed`, not `resolved`. Early referee deployments wrote `resolved`, so
  `src/services/disputes.mappers.ts` normalizes both persisted forms and `firestore.rules`
  documents `open → 'closed'`. Treat `resolved` as a legacy alias. The referee writes a
  `verdict: 'land'|'bail'|'tie'|'none'` and a `resolutionApplied: true` idempotency flag inside the
  resolving transaction.
- Votes stay `land`/`bail` in `disputeVotes/{uid}_{disputeId}` — unchanged mechanically. ("make" in
  product language = `land` in the schema.)

---

## 5. Security (mandatory — these become forgery vectors once binding)

- **Gap A (role self-assertion) — CLOSED by design.** Because `pendingReview` freezes the game with
  `currentSetter`/`turnNumber` still naming the disputed turn, the `disputes` create rule can now
  bind `setterUid == game.currentSetter && turnNumber == game.turnNumber && game.phase == 'pendingReview'`.
  The disputer must be the real setter of the frozen turn.
- **Gap B (delete-and-re-raise resets the tally) — CLOSED.** Remove the client `allow delete` on
  `disputes`; the server referee's `open → closed` close-out replaces it. Account-deletion erasure
  is handled by the existing vote-cascade path, not by deleting the dispute doc.
- **Stats immutability.** The four new counters are added to the `users` create zero-seed and the
  update `affectedKeys().hasAny([...])` backstop, exactly like the Tier-1 fields. Client can never
  write them.
- **Resolver is admin-only.** Only the dispute referee (admin SDK) writes letters/turn/winner and
  stats for a resolution. Clients cannot resolve.
- **Idempotency.** `resolutionApplied` on the dispute doc, re-checked inside the referee transaction;
  a re-run reads a non-open dispute and no-ops. Deterministic dispute id already guarantees one
  dispute per turn.

### Risk R1 — quorum of 1 without App Check

With quorum = 1 and App Check disabled, a single alt/friend account can swing any dispute, and that
now writes real letters and stats. **Accepted for launch by owner.** Recommended mitigation later:
enable App Check (already built, currently disabled) and/or raise the quorum. Tracked, not blocking.

---

## 6. Build phases

Each phase lands as its own reviewed PR. Nothing merges without owner review.

1. **Data model (no behavior change):** add `pendingReview`/`communityReview` to `GamePhase`; add
   `reviewFor`/`reviewDeadline` to the GameDoc type; add the four stat fields to `UserProfile`;
   implement the pure `decideDisputeResolution` helper (shared, SDK-agnostic, like
   `turnForfeit.shared.ts`) + unit tests. No rules, no wiring.
2. **Rules + red-team tests (TDD):** new `pendingReview`/`communityReview` update branches; close
   Gap A + Gap B; `open → closed` transition; stat-field create/update backstops; negative tests
   (re-raise cannot reset a bound tally; client cannot write letters/stats/`statsApplied`; only the
   frozen setter can raise; forged verdicts denied).
3. **Service wiring:** intercept `submitMatchAttempt(landed)` → `pendingReview`; `acceptLanded` and
   `raiseDispute` (binding) service actions; the retry transition; keep client parity with the
   shared helper.
4. **Dispute referee:** `api/cron/resolve-expired-disputes` (mirrors `sweep-expired-turns`) handling
   both `pendingReview` expiry (auto-accept) and `communityReview` resolution (tally → outcome +
   stats); new composite index; GitHub Actions schedule; owner sign-off per CHARTER §4.14.
5. **UI:** the Dispute button on a landed claim; the "under community review" pending screen; the
   land/bail voting surface in the community feed; the four dispute stats on the profile.

---

## 7. Files touched (reference)

- `src/services/games.mappers.ts` — phase enum, GameDoc fields.
- `src/services/games.match.ts` — landed → `pendingReview` interception.
- `src/services/disputes.raise.ts` / `disputes.votes.ts` — binding raise, lifecycle.
- `src/services/dispute.resolution.shared.ts` (new) — pure `decideDisputeResolution` helper.
- `src/services/users.ts` — four new `UserProfile` counters.
- `firestore.rules` — new phase branches, dispute lifecycle, stat backstops, gap closures.
- `firestore.indexes.json` — index for the referee's eligibility query.
- `api/cron/resolve-expired-disputes.ts` (new) — the dispute referee.
- `functions/` — untouched (dispute stats are written by the cron referee, not a Cloud Function).

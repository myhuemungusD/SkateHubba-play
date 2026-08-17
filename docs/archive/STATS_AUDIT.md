# Player Stats Audit — Current State & Roadmap

Status: **Tier 1 implemented 2026-07-26.** Original audit captured 2026-07-24. Companion to `IDEAS_PRO_SKATER_PRIZE.md` (trick difficulty/ratings depend on the Tier 2 aggregation below). Tier 2+ still needs maintainer sign-off on the CI allowlist scope.

## Shipped since the original audit

- **Tier 1 counters live**: `gamesPlayed`, `currentWinStreak`, `bestWinStreak` are written by `applyGameStats` inside the existing close-out transaction. Streaks are absolute writes (not `FieldValue.increment`) because `bestWinStreak` compares against the resulting current streak — safe because the transaction reads the profile doc first. A loss zeroes `currentWinStreak` and never touches `bestWinStreak`.
- **`WinStreakBanner` wired** — it was dead code awaiting a counter. Renders at a streak of 2+; a "1 win streak" is just a win.
- **Win-rate floor** (`src/constants/stats.ts`, `MIN_RATED_GAMES = 5`): rates below the floor render as a dash, not "100%" or "0%". Shared by the profile grid and the leaderboard so the two can't disagree.
- **Leaderboard no longer sorts on raw wins** — gap 5 below. Rated players rank by win rate; provisional players rank after them by volume. The query still pulls by `wins` (Firestore can't order by a computed rate), over-fetching 4× the display size as a candidate pool. This is a heuristic, not a true global rate ranking — that needs a stored rating (Tier 3).
- **Achievements ribbon gated to the owner's own profile** — 12 locked "???" tiles advertising unbuilt features were rendering on every player's public profile.

### Deliberately not tracked

`forfeitLosses` and `lastGameAt` were both proposed in Tier 1 below and were **rejected**. `users/{uid}` is `allow read: if isSignedIn()`, so any field on that doc is readable by every signed-in account — declining to render it in the UI does not make it private. A public quit-counter is socially punitive, and a public last-active timestamp is an activity-pattern leak in an app that already ships blocking and reporting. If either is ever needed, it belongs in `users/{uid}/private/*`.

---

## What is recorded today

Per player, exactly two counters exist: **`wins` and `losses`** on the public `users/{uid}` doc.

The recording pipeline:

- When a game reaches a terminal state (`complete` or `forfeit`) with a winner, the `onGameCompleted` trigger (`functions/src/index.ts`) calls `applyGameStats` (`functions/src/applyGameStats.ts`).
- Inside a transaction it re-validates the game is terminal, checks the `statsApplied` idempotency flag on the game doc, then increments winner `wins` / loser `losses` exactly once.
- `firestore.rules` enforcement: clients can never write `wins`/`losses` (the earlier client peer-write scheme corrupted production counters and was removed), profile creation forces both to start at 0 if present, and clients cannot forge `statsApplied`.

**Verdict on the pipeline: sound.** Server-only, transactional, idempotent, rules-locked.

Everything else surfaced as a "stat" is derived client-side per viewer from game docs in `usePlayerProfileController.ts`: win rate, head-to-head vs. the viewer, per-opponent records. H2H is legitimately per-viewer; the rest is fragile because game docs are deleted on account deletion and the profile loads a bounded set of games.

## Gaps found

1. **Rich per-turn data captured but never aggregated.** Every game doc carries `turnHistory` (trick name, setter/matcher, landed, who took the letter, judge) — used only for clip replay today. This is the raw material for all trick-level stats.
2. **UI already committed to stats that don't exist.** `WinStreakBanner` (needs `currentWinStreak`), `AchievementsRibbon` (placeholder), XP/level chip (hardcoded L1) — all noted "deferred until counters ship" in `PlayerProfileScreen/index.tsx`.
3. **Achievements schema exists with no writer.** `users/{uid}/achievements` has correct owner-read/delete rules (`create/update: if false`) and deletion-cascade handling, but nothing writes achievements.
4. **No-winner terminal games are uncounted.** `applyGameStats` returns `no-winner` without setting `statsApplied` — ties/anomalies tracked nowhere (acceptable, but by omission not decision).
5. **Leaderboard sorts on raw win count** (`getLeaderboard` in `src/services/users.ts`) — 50-200 outranks 20-0. Fixing it needs more counters or a rating.

## Recommended stats to track

### Tier 1 — counters the UI already needs

All incrementable inside the existing `applyGameStats` transaction; no new infrastructure.

| Field              | Update rule                             | Unblocks                      | Status                                        |
| ------------------ | --------------------------------------- | ----------------------------- | --------------------------------------------- |
| `currentWinStreak` | winner +1, loser reset to 0             | `WinStreakBanner`             | ✅ shipped                                    |
| `bestWinStreak`    | `max(best, current)` on win             | profile badge                 | ✅ shipped                                    |
| `gamesPlayed`      | +1 both players (or derive wins+losses) | win-rate everywhere           | ✅ shipped                                    |
| `forfeitLosses`    | +1 loser when status is `forfeit`       | distinguishes quit vs. beaten | ❌ rejected — public shame metric, see above  |
| `lastGameAt`       | server timestamp both players           | activity/recency features     | ❌ rejected — public presence leak, see above |

### Tier 2 — trick-level, folded out of `turnHistory` at close-out

Same function, one pass over the history: tricks set, tricks landed as matcher, match success rate, letters given/taken, most-used trick. This is the on-ramp for the trick difficulty/ratings concept — once tricks carry difficulty scores, "average difficulty landed" comes from this same aggregation.

### Tier 3 — derived

XP/level (unblocks the level chip), server-written achievements (first win, 5-streak, 100 tricks landed) into the existing `achievements` subcollection, and a quality-aware leaderboard sort (win rate with a minimum-games floor, or a simple rating).

## Architectural constraints

- All writers land in `applyGameStats` — the one maintainer-approved Cloud Function — so no new client write paths open.
- Every new counter name must be added to the owner-immutable `affectedKeys().hasAny([...])` backstop list in `firestore.rules`.
- Idempotency comes free from the existing `statsApplied` guard.
- Existing users need a one-time admin backfill (same playbook as the wins/losses backfill).
- The CI allowlist approval (2026-07) was scoped to "stats close-out"; Tier 2/3 expansion of the function needs maintainer sign-off before implementation.

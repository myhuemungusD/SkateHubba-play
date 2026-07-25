# Player Stats Audit — Current State & Roadmap

Status: **Audit + recommendation, captured 2026-07-24.** Companion to `IDEAS_PRO_SKATER_PRIZE.md` (trick difficulty/ratings depend on the Tier 2 aggregation below). No implementation committed; Tier 2+ needs maintainer sign-off on the CI allowlist scope.

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

| Field | Update rule | Unblocks |
| --- | --- | --- |
| `currentWinStreak` | winner +1, loser reset to 0 | `WinStreakBanner` |
| `bestWinStreak` | `max(best, current)` on win | profile badge |
| `gamesPlayed` | +1 both players (or derive wins+losses) | win-rate everywhere |
| `forfeitLosses` | +1 loser when status is `forfeit` | distinguishes quit vs. beaten |
| `lastGameAt` | server timestamp both players | activity/recency features |

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

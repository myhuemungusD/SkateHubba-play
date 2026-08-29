# Player Stats — Roadmap & Constraints

**Status:** Tier 1 shipped 2026-07-26. Tier 2 and Tier 3 are **not** started and
gated on maintainer sign-off (see Architectural constraints).

Extracted 2026-08-26 from `docs/archive/STATS_AUDIT.md`, which had left forward-
looking work — including an unmet approval gate — sitting inside the archive
directory. The historical audit stays archived; this file carries what is still
live. Companion to `docs/archive/IDEAS_PRO_SKATER_PRIZE.md` (trick difficulty and
ratings depend on the Tier 2 aggregation below).

## Shipped — Tier 1

`gamesPlayed`, `currentWinStreak`, `bestWinStreak`, written by `applyGameStats`
inside the existing close-out transaction. Streaks are absolute writes (not
`FieldValue.increment`) because `bestWinStreak` compares against the resulting
current streak — safe because the transaction reads the profile doc first. A
loss zeroes `currentWinStreak` and never touches `bestWinStreak`.

A win-rate floor (`src/constants/stats.ts`, `MIN_RATED_GAMES = 5`) renders rates
below the floor as a dash, shared by the profile grid and the leaderboard so the
two cannot disagree.

See `docs/DECISIONS.md` for why `forfeitLosses` and `lastGameAt` were rejected.

---

## Not started

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

# Decision Log

Records scope decisions, deferred work, and known technical debt so that verbal agreements don't get lost.

---

## DEC-001 — Landing page: autoplay video hero and custom fonts deferred

**Date:** 2026-03-20
**Status:** Deferred
**Category:** Scope / Landing Page

### Context

During landing page development, two features were discussed:

1. **Autoplay video hero** — a looping background video in the hero section to showcase gameplay.
2. **Custom font additions** — adding skateboarding-culture typefaces beyond the current system/brand fonts.

Both were verbally pushed back due to bandwidth constraints and uncertainty about asset licensing.

### Decision

Neither feature is included in the current landing page (`src/screens/Landing.tsx`). They are deferred to a future iteration.

### Future work (not scheduled)

- Evaluate autoplay hero video (asset source, file size budget, mobile fallback image).
- Evaluate custom font additions (licensing, FOUT/FOIT strategy, performance impact).

---

## DEC-002 — STL assets: storage location unknown, not tracked

**Date:** 2026-03-20
**Last reviewed:** 2026-04-15
**Status:** Accepted — assets untracked
**Category:** Assets / Ops

### Context

Logo plaque and staircase STL files were generated at some point for potential physical merchandise or 3D-printing use. They are not checked into version control (no `.stl` files exist in the repo), and as of the 2026-04-15 review their current storage location is not known.

### Decision

STL files are **not** required for the app and will not be tracked. If physical merch or 3D-printing needs arise later, the files will be regenerated from source (CAD / modelling tools) rather than recovered. STL binaries should never be committed to the git repo (binary bloat); if they need a home in the future, use Git LFS or a shared drive with named versions.

---

## DEC-003 — Firestore query pagination: `subscribeToMyGames` capped per listener, no cursor

**Date:** 2026-03-20
**Status:** Open — acceptable short-term, needs fix before scale
**Category:** Infra / Firestore

### Context

`subscribeToMyGames` in `src/services/games.subscriptions.ts` runs three parallel
`onSnapshot` queries (player1, player2, judge), each capped at `limitCount`
documents (defaults to `20`):

```ts
const q1 = query(gamesRef(), where("player1Uid", "==", uid), limit(limitCount));
const q2 = query(gamesRef(), where("player2Uid", "==", uid), limit(limitCount));
const q3 = query(gamesRef(), where("judgeId", "==", uid), limit(limitCount));
```

This caps each listener at `limitCount` documents per slice, which is a reasonable guard against unbounded reads at the current user base size. However, there is no `startAfter` cursor, so users with more than `limitCount` games on any slice will silently lose visibility of older games.

### Decision

A fixed per-listener `limit` is acceptable for the current scale. True cursor-based pagination (or a "load more" UX) is deferred until usage data shows users approaching the cap.

### Risks

- Users with more than `limitCount` games as player1, player2, **or** judge will not see their oldest games on that slice.
- No warning is surfaced to the user when the cap is hit.

### Future work (not scheduled)

- Add `startAfter` cursor support and a "Load more" button when game count approaches 50.
- Consider adding a Firestore composite index on `(playerXUid, updatedAt)` to support ordered pagination.
- Optionally surface an in-app notice when the 50-game cap is reached.

---

## DEC-004 — Clip ranking: `upvoteCount` aggregate field

**Date:** 2026-04-29
**Status:** Accepted
**Category:** Data model / Clips feed

### Context

Clip upvote counts were derived on demand via `getCountFromServer` over `clipVotes` filtered by `clipId`. That works for per-page fan-out but blocks any Top-ranking server-side query — Firestore can't sort by a count it doesn't store.

### Decision

Add a server-validated `upvoteCount: number` aggregate to each `clips/{id}` doc. The field is maintained inside the same `runTransaction` that creates the matching `clipVotes/{uid_clipId}` doc — pairing the vote-doc write with a `±1` `increment` keeps the aggregate consistent with its underlying votes. Firestore rules use `exists` / `existsAfter` on the vote-doc path to bind the count delta to a real create/delete, so a client cannot inflate or deflate the count without the matching vote action. Existing clips are seeded by `scripts/backfill-clip-upvote-count.mjs`.

---

## DEC-005 — Lighthouse Performance: assert level reverted from `error` to `warn`

**Date:** 2026-05-17
**Status:** Accepted (with follow-up)
**Category:** CI / Performance

### Context

PR #337 (May 16) promoted `categories:performance` from `warn` to `error` at the
0.8 threshold, intending to gate regressions. That PR's CI run happened to land
at the top of the score's natural variance and passed. Subsequent runs revealed
the codebase's actual Lighthouse Performance score oscillates **0.71–0.78**
across runs against the local `vite preview` build with placeholder Firebase
env vars (the same configuration CI uses).

Verified empirically on PR #347 (avatar + profile UX layered):

- `main` @ `85aaab9`: scored 0.73 (single run)
- `claude/profile-ux-layered`: scored 0.78, then 0.71 on a second run

The 0.80 gate is unmet by `main` itself. Every PR rolled forward from `main`
is gambling on variance to pass.

### Root cause (diagnosed, not fixed in this change)

The Largest Contentful Paint element is the hero `<h1>` text inside
`<section id="hero">`, rendered by React after the initial JS bundle parses
and hydrates. LCP timing comes back at ~6s on cold loads because the page
shipped from the server is effectively an empty `<div id="root">`. FCP fires
quickly (~1.6s), but LCP waits for React boot + render + font swap.

The font-side fix (async-loading the Google Fonts stylesheet via
`media="print" onload="..."`) was attempted on PR #347 and made FCP **worse**
(1.6s → 1.9s) without moving LCP. The real fix is to render the hero markup
statically into `index.html` so it paints at FCP instead of after hydration.

### Decision

Revert `categories:performance` to `warn` on the 0.8 threshold. Keep
`categories:accessibility` at `error` (0.9) — it is genuinely passing.

Rationale:

- `error`-gating a metric the codebase fails on `main` makes every PR red on
  the variance unlucky case. CI noise → real failures get ignored.
- `warn` keeps the score visible in CI logs so regressions surface, without
  blocking unrelated PRs from shipping.
- The accessibility gate stays — that one is real and passing.

### Follow-up

A focused performance PR is required to make the perf gate enforceable
again. Scope:

1. Pre-render the hero `<h1>` markup into `index.html` so the LCP candidate
   paints at FCP (drops LCP from ~6s to ~1.6s, raises Performance score by
   an estimated 0.10–0.15 based on current LCP weighting).
2. Defer the eager `firebase` bundle (currently 86% wasted on initial paint
   per the LHR report) — investigate lazy `init()` after first user
   interaction or first authenticated route.
3. Once both ship and three consecutive `main` runs score ≥ 0.80, promote
   `categories:performance` back to `error` in a separate PR.

This work is **not** scheduled — it belongs to whoever picks up the perf
follow-up. Tracking in `docs/STATUS_REPORT.md`.

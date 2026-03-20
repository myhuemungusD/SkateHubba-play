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

### Backlog items

- [ ] Evaluate autoplay hero video (asset source, file size budget, mobile fallback image).
- [ ] Evaluate custom font additions (licensing, FOUT/FOIT strategy, performance impact).

---

## DEC-002 — STL assets: storage location and usage path undocumented

**Date:** 2026-03-20
**Status:** Open
**Category:** Assets / Ops

### Context

Logo plaque and staircase STL files were generated for potential physical merchandise or 3D-printing use. The files are not checked into version control (no `.stl` files exist in the repo) and their current storage location is undocumented.

### Decision

STL files should **not** be committed to the git repo (binary bloat). They need a documented home.

### Action items

- [ ] Confirm current storage location of STL files (Google Drive, local machine, etc.) and record it here.
- [ ] Add STL file references to project asset inventory once a storage location is chosen.
- [ ] Decide whether STL assets need versioning (e.g., Git LFS or a shared drive with named versions).

---

## DEC-003 — Firestore query pagination: `subscribeToMyGames` capped at 50, no cursor

**Date:** 2026-03-20
**Status:** Open — acceptable short-term, needs fix before scale
**Category:** Infra / Firestore

### Context

`src/services/games.ts` lines 380–381 use `limit(50)` for both player-side queries:

```ts
const q1 = query(gamesRef(), where("player1Uid", "==", uid), limit(50));
const q2 = query(gamesRef(), where("player2Uid", "==", uid), limit(50));
```

This caps each listener at 50 documents per side (up to 100 total after dedup), which is a reasonable guard against unbounded reads at the current user base size. However, there is no `startAfter` cursor, so users with more than 50 games per side will silently lose visibility of older games.

### Decision

`limit(50)` is acceptable for the current scale. True cursor-based pagination (or a "load more" UX) is deferred until usage data shows users approaching the cap.

### Risks

- Users with > 50 games as player1 **or** > 50 games as player2 will not see their oldest games.
- No warning is surfaced to the user when the cap is hit.

### Action items

- [ ] Add `startAfter` cursor support and a "Load more" button when game count approaches 50.
- [ ] Consider adding a Firestore composite index on `(playerXUid, updatedAt)` to support ordered pagination.
- [ ] Optionally surface an in-app notice when the 50-game cap is reached.

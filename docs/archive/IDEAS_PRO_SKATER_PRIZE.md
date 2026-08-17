# Idea Lock-In: Pro Skater Prize Events & Trick Ratings

Status: **Concept — not scheduled.** Captured 2026-07-24 for later refinement. Nothing here is committed work; details TBD in a follow-up session.

---

## Idea 1: "Skate a Pro" — Prize Events

### One-line pitch

Sell limited entry spots to play a live game of S.K.A.T.E. against a pro skater on SkateHubba — the winner takes home the actual board the pro rode during the game.

### How it works (draft flow)

1. **Event creation.** SkateHubba schedules an event with a pro skater on a set date/time (e.g. "Play [Pro Name] — Aug 30, 7pm").
2. **Sponsorship.** Skate shops and brands co-sponsor the event — they fund the pro's appearance and prizes in exchange for placement on the event page, in-game branding, and promo to entrants.
3. **Spot sales.** A limited number of entry spots are sold (e.g. 32 or 64). Entrants could play the pro directly (short format), or play through a bracket where the finalist faces the pro live.
4. **Live game.** The game runs on the existing remote S.K.A.T.E. flow — pro records tricks on video, opponents match. Optionally streamed/spectatable in-app.
5. **The prize.** The pro's deck from the event — signed, ridden during the actual game — ships to the winner. Sponsors can add prize packs (shop gift cards, product).

### Why it's strong

- **Uses what we already have.** The async video S.K.A.T.E. game loop is the product; this is a monetizable event layer on top, not a new game mode.
- **Physical + digital prize.** A board that was actually played in the game is verifiable, unique memorabilia — much stronger than a generic giveaway.
- **Three-sided value.** Players get access to pros; pros get paid appearances plus exposure; shops/brands get engaged, targeted audience.
- **Local shop angle.** Shops can sell spots in-store (QR code at the counter), pulling their existing community into the app.

### Open questions (to resolve before any build)

- Payments: we have no payment infra and the architecture guardrails say no custom backend. Spot sales may need an external checkout (e.g. Stripe Payment Links / Shopify via the sponsor shop) with entry codes redeemed in-app — needs discussion.
- Format: direct 1v1s against the pro vs. bracket-to-face-the-pro. Bracket scales better (one pro game per event).
- Legal: sweepstakes/contest law varies by state/country when entry costs money and there's a prize. Needs real review before selling anything.
- Live vs. async: "live" needs scheduling + possibly spectator mode; async fits current infra better.
- Prize fulfillment: who ships the board, authenticity proof (event VOD + signature), international shipping.
- Pro verification: verified pro accounts (badge, managed onboarding).

### Possible product surface (future)

- Events screen: upcoming events, spot availability, countdown, sponsor logos.
- Spectator mode for event games.
- Winner showcase / hall of fame with the game replay attached to the physical board's story.

---

## Idea 2: Trick Ratings & Difficulty

### One-line pitch

Every trick has a difficulty rating, and the community can rate the quality of a landed trick clip — turning raw wins into meaningful skill signal.

### Draft shape

- **Difficulty score per trick.** A seeded catalog of named tricks (kickflip, tre flip, hardflip, etc.) each with a base difficulty tier or numeric score. Modifiers for stance (switch/nollie/fakie) and terrain could multiply difficulty later.
- **Clip quality ratings.** Opponents and/or spectators rate a landed clip (e.g. 1–5 or fire-emoji scale) on style/cleanness — separate from whether it counted in the game.
- **Where it feeds in:**
  - Player profiles: average difficulty attempted/landed, best-rated clips.
  - Matchmaking/leaderboards: difficulty-weighted stats are a better skill signal than raw win %.
  - Prize events (Idea 1): difficulty floors or judged formats for the pro games.

### Open questions

- Who rates: opponent only, any viewer, or a hybrid with anti-brigading limits (rate-limited in rules, one rating per user per clip).
- Is difficulty self-declared ("I'm doing a tre flip") vs. named-and-confirmed by the opponent? Self-declared needs a dispute path.
- Trick catalog: where the canonical list and scores come from, and how it's versioned.
- Firestore shape: ratings are a new write path — `firestore.rules` must enforce one-rating-per-user and immutability; stats aggregation may fit the existing approved stats close-out function, or may not — needs rules-guardian + maintainer review.
- Keep game outcome and ratings decoupled: ratings must never change who won a round.

---

## Sequencing note

Idea 2 (trick ratings/difficulty) is a prerequisite-ish for the best version of Idea 1 — judged/difficulty-aware event formats need the ratings foundation. Suggested order when we pick this up: trick catalog + difficulty first, clip ratings second, events layer last.

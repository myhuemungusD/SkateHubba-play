# SkateHubba Roadmap

**Vision:** SkateHubba becomes the identity and gameplay layer for skating — where clips turn into battles, battles turn into crews, crews turn into cities, and cities turn into a skate graph no content app or spot finder can replicate.

**Philosophy:** Find product-market fit first. Nail one thing, prove it works with real skaters, then expand. No feature factory.

---

## How to read this

This document is **direction** — what we are trying to prove next and what is deliberately not being built.

It is not a status board. Per-feature status, with file-level evidence for every claim, lives in [docs/STATUS_REPORT.md](docs/STATUS_REPORT.md), and the shipped-feature summary lives in the [README roadmap section](README.md#roadmap-async-gameplay--network-effects). When those disagree with this file, they are right and this file is stale.

Architectural boundaries are set by [docs/CHARTER.md](docs/CHARTER.md). Nothing here overrides it.

---

## Where we are (Aug 2026)

Released **v1.1.0**, live at [skatehubba.com](https://skatehubba.com).

| Phase                              | State                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Phase 1 — Core Loop                | Shipped                                                                   |
| Phase 2 — Viral Mechanics          | Shipped                                                                   |
| Phase 3 — Social Graph & Discovery | Shipped except spectator mode (deferred)                                  |
| Phase 4 — Network Effects          | Partial — spots/map shipped; crew, trick library, tournaments not started |
| Referee System                     | Shipped (v1.1.0)                                                          |
| Binding community disputes         | Shipped post-v1.1.0 (not yet in a CHANGELOG release section)              |

**The core loop is built.** Async games, video proof, push delivery, clips feed with vote-driven ranking, leaderboard, profiles, spot map, moderation — all in production. The open question is no longer _can we build it_. It is _do skaters use it_.

---

## Now — prove the loop with real skaters

> The goal is **completed games by real skaters**. Not signups. Not downloads. Games that reach a win or a forfeit.

Feature work in this stretch is only justified if it removes friction from that number.

- [ ] **Reconstruct the CHANGELOG and cut the missing git tags** — `git tag` is empty despite the CHANGELOG linking to `v1.0.0` and `v1.1.0` release pages, and the ~16 `feat:` commits since v1.1.0 (admin console, user clips, community disputes, badges/locker, store pipeline, social cards) have no entry.
- [ ] **Instrument the traction number** — `game_completed` already fires (`src/services/analytics.ts`). Stand up the reporting so completed-game count and completion rate are visible without hand-counting.
- [ ] **Close the abandonment gaps** — read drop-off across `game_created → trick_set → match_submitted → game_completed` and fix whichever stage bleeds hardest.
- [ ] **Return rate** — do players who finish a game start a second one within 7 days?

### Exit criteria

- 100 completed S.K.A.T.E. games by real users (not team, not friends-of-founder)
- Game completion rate > 70% (started vs. finished)
- 30%+ of players start a second game within 7 days

These are the same criteria that gate the economy work. Nothing in [docs/ECONOMY.md](docs/ECONOMY.md) starts before they are met.

---

## Next — finish Phase 4

Unlocks after the traction numbers hold, in whatever order the data argues for:

- [ ] Custom Mapbox style ([#191](https://github.com/myhuemungusD/SkateHubba-play/issues/191)) — design/infra, no app code
- [ ] Crew challenges (3v3) — multiplies each invite
- [ ] Trick library — community trick index with video proof
- [ ] Tournaments — bracket competitions for appointment engagement
- [ ] Spectator mode — deferred 2026-04-15, eligible for revisit now that ranked clips ship engagement data

## Shipped — economy phase A

Achievement badges (`src/services/achievements.ts`, `src/constants/badges.ts`), Verified Pro (`src/components/ProUsername.tsx`), Hubba Locker v1 + collection showcase (`src/services/locker.ts`, `src/components/LockerShowcase.tsx`) are all live on `main`. See [docs/ECONOMY.md](docs/ECONOMY.md) for the phasing and the rules that constrain later phases (B/C remain gated on traction).

---

## Ops backlog

Not features, not optional. Tracked in [docs/STATUS_REPORT.md](docs/STATUS_REPORT.md) §7:

- [x] Automate Firestore rules deploy in CI — `.github/workflows/firebase-rules-deploy.yml` (deploy on merge to `main` + daily freshness check)
- [ ] Daily Firestore managed exports — tooling built (`.github/workflows/firebase-infra-setup.yml`, manual dispatch); confirm it has been run against production
- [ ] Storage lifecycle rule for old videos — same workflow, same caveat
- [ ] GitHub branch protection rules applied
- [ ] Accessibility (axe-core) in CI
- [ ] TTL cleanup for username reservations

---

## Icebox

Parked. Distractions until the traction number lands:

- AI trick recognition
- AR/VR features
- Blockchain / NFTs — evaluated Aug 2026 and rejected; the economy works without them (see [docs/ECONOMY.md](docs/ECONOMY.md))
- Speed S.K.A.T.E. / new game modes
- Multi-language / global expansion
- Esports / pro league
- Smart sensors / wearables
- Paid/premium tier — benched Aug 2026; if revived, its display name must not collide with Verified Pro
- Hubba Vault provenance/authentication — parked pending a credible authentication answer

**Graduated to a phased plan** (still gated, see [docs/ECONOMY.md](docs/ECONOMY.md)):

- Profile themes / cosmetics → Economy Phase A (Locker, badges)
- Custom trick challenges / bounties → Economy Phase D (sponsored challenges)
- Brand sponsorships / partnerships → Economy Phase D (Brand-Ready Checklist)

**Revisit the icebox quarterly.** If a real user asks for one of these, pay attention. Otherwise, ignore.

---

## How we decide what to build

1. **Does it move the current stretch's exit criteria?** If no, it waits.
2. **Is a real user asking for it?** Signal > opinion.
3. **What's the smallest thing we can ship to learn?** Bias toward small bets.
4. **Does the charter allow it?** If it needs a banned dependency or a backend, the answer is no — reopen [docs/CHARTER.md](docs/CHARTER.md) first, don't route around it.

---

## Feature requests

Open a GitHub Issue tagged `[Feature Request]`. Community votes with thumbs-up. We still only build what the current stretch demands.

---

## Links

- [Economy & Creator Ecosystem](docs/ECONOMY.md)
- [Feature Status Report](docs/STATUS_REPORT.md)
- [Operating Charter](docs/CHARTER.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Game Mechanics](docs/GAME_MECHANICS.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

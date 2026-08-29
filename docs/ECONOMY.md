# SkateHubba Economy & Creator Ecosystem

> **Status:** Vision document. Nothing here ships before the traction criteria in [ROADMAP.md](../ROADMAP.md) are met.
> **Constraints:** [docs/CHARTER.md](CHARTER.md) governs. Every mechanic below is designed for Firestore — no new datastore, no backend, no Cloud Functions beyond the approved set.

SkateHubba is more than a place to find skate spots or play games of S.K.A.T.E. The long-term goal is a digital skateboarding ecosystem where **actually skating creates value**. A skater's activity inside SkateHubba builds their identity, reputation, collection, content library, and eventually their ability to earn money.

## Core Principles (non-negotiable)

1. **Earned beats purchased.** SkateHubba never gives someone more status for spending money than for skating. The rarest and most respected items are earned with a skateboard, not a credit card.
2. **Money flows in, never out — for the game economy.** Hubba Bucks are an in-app currency, not cryptocurrency, and cannot be cashed out for dollars. Creator earnings (Phase D) are a separate system with real payment rails, kept fully apart from the game economy.
3. **No blockchain, no NFTs.** Everything valuable here works with Firestore. Scarcity comes from _why and when_ an item was issued, and the system records issuance date, reason, and ownership history. Rejected Aug 2026 — see the icebox in [ROADMAP.md](../ROADMAP.md).
4. **Badges can never be bought.** No badge is purchasable through any pathway — not with money, not with Hubba Bucks. Badges are earned or (for verification badges only) human-approved.
5. **No randomized paid rewards.** No loot boxes. Anything bought with real money or purchased currency has a known, fixed outcome. Earned rewards may include surprise drops; paid ones may not.

## The Core Loop

Skate → Compete → Complete Challenges → Earn → Collect → Customize → Trade → Create → Build Reputation → Earn Opportunities

Every part feeds back into skating.

---

## Hubba Locker

Every profile has a **Hubba Locker** of collectible digital items — decks, wheels, trucks, shoes, apparel, accessories, and limited-edition items — displayed on the profile and used to customize the skater's SkateHubba identity.

Some items are purchased. The best items are only obtainable by doing something inside SkateHubba:

- Win 10 games of S.K.A.T.E. → unlock a deck
- Complete a kickflip challenge → unlock shoes
- Win a regional competition → receive a numbered limited item

**Engineering note — already implemented.** `users/{uid}/locker/{itemId}` exists in `firestore.rules` with a fully pinned item shape (`type`, `brand`, `name`, `imageUrl`, `rarity`, `acquiredAt`, `provenance`; strings length-capped, `acquiredAt` server-stamped) and is served by `src/services/locker.ts`. The posture is **`allow read: if isSignedIn()`** (equipped gear is public reputation, rendered on `/player/:uid`), **`allow create: if isAdmin()`**, `allow update: if false`, and `allow delete: if isOwner(uid) || isAdmin()` — not `create: if false` as this note originally proposed. Each document carries the item identity (type, brand, name, image) plus provenance — issuance timestamp, reason, and issuing event — because provenance _is_ the scarcity model. Awards are written by the same Admin-SDK path that maintains `users/{uid}` stat fields; a client that can mint its own gear has no economy.

## Badges & Verification

Badges are the reputation layer. Two kinds exist, and both share one rule: **no badge can ever be purchased.**

### Verified Pro

A human-approved badge for genuinely professional skateboarders. Approval is manual, granted only by designated verifiers from the professional skate community — no self-serve application queue at launch. Every grant records who approved it and when, and grants are revocable. This badge is about credibility: when a pro is on SkateHubba, everyone knows it's really them.

**Already partly built.** `users/{uid}` carries `isVerifiedPro`, `verifiedBy`, and `verifiedAt` as admin-only fields that clients cannot set or modify, and `src/components/ProUsername.tsx` renders the badge. What remains is the grant/revoke workflow and the verifier roster — not the data model.

### Achievement Badges

Earned automatically from real activity. The launch set is deliberately small so each one means something — more can be added later, but scarcity of badge types is part of their value.

Proposed launch set (names are placeholders). Every criterion below reads from fields that already exist and are already server-maintained:

| Badge    | Criteria                                                    | Data source                 |
| -------- | ----------------------------------------------------------- | --------------------------- |
| Century  | Complete 100 games                                          | `users/{uid}.gamesPlayed`   |
| 150 Club | Win 150 games                                               | `users/{uid}.wins`          |
| OG       | Account created during launch year — never obtainable again | `users/{uid}.createdAt`     |
| Streak   | Win 10 games in a row                                       | `users/{uid}.bestWinStreak` |
| Pioneer  | Author spots the community actually plays at                | `spots` + `games.spotId`    |

Time-locked badges (like OG) create real scarcity: an early SkateHubba badge means something five or ten years later because the system knows exactly when and why it was issued.

**Engineering note.** `users/{uid}/achievements/{achievementId}` already exists in `firestore.rules`, though not quite as described in earlier drafts: it is **readable by any signed-in user** (deliberately — badges render on another skater's `/player/:uid`), `create` is **admin-only** with a pinned `['earnedAt', 'reason']` shape rather than denied to all clients, `update` is denied outright, and `delete` is owner-or-admin (the owner needs it so the GDPR erasure batch can wipe badges atomically with the parent doc). Badge awards go through the Admin SDK alongside the stats close-out that already maintains `wins`, `losses`, `gamesPlayed`, `currentWinStreak`, and `bestWinStreak`. Four of the five launch badges are a read of a counter that is already correct.

Note the Pioneer criterion differs from earlier drafts: there is no check-in feature in this codebase. Spot engagement is measured through games linked to a spot (`games.spotId`, already populated by the challenge-from-spot flow), not check-ins.

### Future: Verified Affiliations (Sponsor / Flow / Team / Shop)

Skaters will eventually display who they ride for — sponsors, flow programs, shop teams, crews. This requires two-sided verification: the skater claims the affiliation, and the brand/shop (or a SkateHubba verifier) confirms it. Unverified claims are not displayed as verified. This ships only after brand relationships are formalized — see Brand-Ready Checklist below.

**Paid tier status: benched (Aug 2026).** No paid account tier exists in the current schema and none ships for now. If one is ever revived, its display name must not be "Pro" while Verified Pro exists; verification and billing must never look like the same thing.

---

## Hubba Bucks

SkateHubba's internal currency, earned through challenges, achievements, games, competitions, events, spot activity, and promotions — and spent in the Hubba Shop on digital items, customization, and limited drops.

Hubba Bucks are **not** cryptocurrency and are **never** cashed out for dollars. At launch, Hubba Bucks are earned-only. Purchasable Hubba Bucks come later, and when they do, purchases go through Apple/Google in-app purchase as required by app store policy.

**Engineering note.** A balance is a server-maintained field on `users/{uid}` with the same client-read/server-write posture as the stat counters, and every mutation is a ledger entry, not a bare increment. Spending and awarding happen in a single `runTransaction` — the charter's transaction rule applies to currency exactly as it applies to game state.

## Hubba Shop

The shop has two halves with **different payment rails**:

- **Digital items** (avatar gear, limited drops, branded digital items): bought with Hubba Bucks. If Hubba Bucks become purchasable with real money, that purchase goes through IAP (Apple/Google take their cut of the currency purchase).
- **Real products** (decks, wheels, apparel): physical goods are exempt from IAP and run through Stripe with no app store cut.

Eventually brands release items inside SkateHubba: complete a brand-sponsored challenge, receive the digital gear; a limited number of players win or buy the physical version. Digital activity connects to actual skate culture instead of a separate fake world.

## Player Trading

Collectible items can eventually be traded between users. A collection becomes part of identity: some items are common; others exist only because someone attended an event, completed a brutal challenge, won a competition, or was here early. The system records when an item was issued, why it was earned, and every player who has owned it — that's real scarcity and provenance without blockchain.

Trading ships **after** the player base is large enough for a market to function, with: atomic swaps (both sides moved in one `runTransaction` — non-negotiable, this is the same class of race condition the game writes already guard against), trade confirmation UX, full trade audit log, rate limits, and rollback capability. Items bought with real money (directly or via purchased currency) are either non-tradable or trading carries no cash-out path anywhere — this keeps the economy out of money-transmission territory.

## Hubba Moments

Games and challenges naturally create thousands of clips. Instead of clips vanishing into a feed, important ones become **Hubba Moments** — a clip that carries its full context:

> Kickflip Back Tail · Game of S.K.A.T.E. vs. [opponent] · Venice · Final letter trick · August 2026

Skaters pin Moments to their profile and build a digital skate résumé over time.

**Engineering note.** `clips/{clipId}` already stores `trickName`, `gameId`, `turnNumber`, `role`, and `spotId`, and clip documents are written atomically inside the `submitMatchAttempt` / `resolveDispute` transactions. A Moment is a featured flag plus display treatment over data already captured — the cheapest high-value item in this document.

## Creator Economy

The bigger vision: talented skaters benefit financially from activity they're already creating. In order of viability:

1. **Gear tagging → commissions.** A skater tags their setup (deck, trucks, wheels, shoes). Purchases through SkateHubba earn the skater a commission. Starts with affiliate programs (no payout infrastructure needed on day one), graduates to direct brand deals. _Validate actual affiliate/commission rates for skate hardgoods and footwear before promising numbers to skaters._
2. **Sponsored challenges.** Brands sponsor real skate challenges and competitions with digital and physical prizes. There is no `challenges` collection today — this builds on the existing game-creation flow rather than a system that already exists, and that scoping work is part of Phase D.
3. **Clip licensing.** Skaters allow brands, media, or creators to license footage; SkateHubba brokers and takes a cut.
4. **Creator programs.** Payouts based on legitimate engagement, competitions, and campaigns. Ships **last**: it requires revenue to fund it, Stripe Connect payout rails with KYC and tax reporting, and payout-grade fraud prevention (view counting becomes adversarial the day views pay).

Someone shouldn't have to turn pro to make money from being good at skating.

## Hubba Vault — _in planning, not scheduled_

The long-term idea: preserve physical skate collectibles (old decks, signed decks, rare shoes, memorabilia, photography) with a SkateHubba record of photos, history, and ownership — Carfax for skate collectibles.

**Why it's parked:** the record-keeping is easy; **authentication is the hard problem**. A provenance chain is only as trustworthy as its first claim, and QR/NFC tags can be moved between items. Solving this credibly (the way StockX/PSA use human authenticators) is its own business, not a feature. What ships in the meantime is the personal, non-tradable **collection showcase** — photos of your gear on your profile, no ownership or authenticity claims made.

**Open questions before Vault leaves planning:** who authenticates and how; liability for false provenance; whether tags can be made tamper-evident; unit economics of authentication.

---

## Brand-Ready Checklist

Brand conversations happen when the product can be demoed, not pitched. "Ready" means:

1. **Retention proof** — the traction criteria in [ROADMAP.md](../ROADMAP.md) hit (100 completed games, completion and return rates). Brands ask "how many actives" first.
2. **Locker + badges live** — profiles visibly display earned gear and badges.
3. **One sponsored-challenge flow working end-to-end** — create challenge → skater completes with video proof → item/badge auto-awarded — demoable on a phone in under two minutes.
4. **Moderation live** — brands will not attach their name to an unmoderated video platform. Block, report, and `moderationStatus` on clips already exist; they must be operationally staffed, not just present.
5. **A one-pager and 60-second demo video.**
6. **A simple partnership terms template** — what the brand gets: challenge sponsorship, limited item drop, engagement analytics.

Founder relationships in the professional skate community are the door-opener; this checklist is what walks through it. Individual names and specific brands are deliberately kept out of this document — commitments belong in signed agreements, not repo docs.

---

## Phasing (gated by ROADMAP.md)

| Phase        | Ships                                                                           | Gate                                                                  |
| ------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **A**        | Achievement badges, Verified Pro grant workflow, Locker v1, collection showcase | Traction criteria met (100 completed games)                           |
| **B**        | Hubba Bucks (earned-only), Hubba Shop digital items, Hubba Moments              | Phase A live + retention holding                                      |
| **C**        | Player trading, purchasable Hubba Bucks via IAP, verified affiliations          | Player base large enough for a market; brand relationships formalized |
| **D**        | Gear commissions, sponsored challenges, clip licensing, creator program         | Phase C live + Brand-Ready Checklist complete                         |
| **Planning** | Hubba Vault provenance/authentication                                           | Open questions above answered                                         |

## Why This Matters

Most social platforms reward posting. Most games reward playing the game. **SkateHubba rewards actually skateboarding.** The phone doesn't replace skating — the digital world sits on top of the real one:

Real skating → games & challenges → clips & achievements → reputation & collectibles → community & competition → brand and creator opportunities → real-world value → back to skating.

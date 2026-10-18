# Map Roadmap: SkateHubba Go

Jason's goal for the map: make it a Pokémon Go for skating. Spots are the stops, skate shops are special stops, King of the Spot works like a gym, and the map is the reason you leave the house to skate. This doc lays out how to get there in stages. Each stage is fun on its own, and the plan reuses what is already built.

## Ground rules

These hold in every phase. A PR that breaks one of them does not merge.

- **Hubba Bucks never cash out.** No loot boxes, no NFTs, no paid randomness. Bounties pay XP, badges, and earned Bucks only.
- **Badges are earned, never bought.** No badge, crown, or passport stamp can be bought with money or Bucks.
- **Every feature is behind its own default-off flag.** Each flag turns on first only for the testers in `config/featureTesters` (Jason and Mike), then for everyone.
- **Real brand logos only with written permission** from that brand. Shops without a deal get a plain pin and their name.
- **The camera crosshair does not change.** Map challenges record with the existing camera exactly as it is.
- **One low-clutter feed.** Crowns taken, bounties, check-ins, and events show up as cards in the existing feed. No new tabs and no second feed.
- **Location privacy by default.** Nobody shows on the map unless they opt in, and what others see is fuzzed.

## What is already built

Audit of the current code, so we build on top of it rather than next to it.

| Piece               | Where it lives                                                                                                           | What it gives us                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spot map            | `src/screens/MapPage.tsx`, `src/components/map/` (`SpotMap`, `useSpotsInBounds`, `useSpotMarkers`, `useUserGeolocation`) | Mapbox map, spot pins in the visible area, the user's own location.                                                                                                           |
| Spots               | `src/services/spots.ts`, `spots/{spotId}` rules                                                                          | Spot create with full rules validation, a 30s create cooldown, `isVerified` that clients cannot set, bounds and nearby queries (latitude query plus client filter), comments. |
| Spot chats          | `src/services/spotMessages.ts`, `src/components/SpotChat`, `spots/{spotId}/messages` rules                               | Per-spot chat with rate limits, reports, and hide/unhide moderation. Flag `isSpotChatsEnabled`.                                                                               |
| Games at spots      | `src/services/games.*.ts`, `functions/src/applyGameStats.ts`                                                             | S.K.A.T.E. from any two locations already exists. A game can carry a `spotId`.                                                                                                |
| Referee             | `src/services/games.judge.ts`, flag `isRefereeEnabled`, disputes (`disputes.*.ts`)                                       | Judging and dispute flow we can reuse for crown battles.                                                                                                                      |
| XP and achievements | `docs/XP_LEVELS.md`, `src/services/achievements.ts`, `users/{uid}/xpMarkers`                                             | Server-written XP, anti-farming taper, `spotsPlayed` counter with `spot_{spotId}` markers, `spots_1/5/20` and `homespot_*` badges. Flag `isXpEnabled`.                        |
| Badges row          | `src/components/BadgesRow.tsx`                                                                                           | Where passport badges show on the profile.                                                                                                                                    |
| Feature flags       | `src/lib/featureFlags.ts`, `src/services/featureTesters.ts`, `config/featureTesters`                                     | Default-off flags with a tester override for Jason and Mike.                                                                                                                  |
| Push                | `src/services/pushDispatch.ts`, `functions/src/push`                                                                     | Notifications for "your crown was taken" and challenges.                                                                                                                      |
| Profile             | `docs/PROFILE_CUSTOM.md`, `src/components/ProfileShowcase.tsx`                                                           | Where the spot passport goes.                                                                                                                                                 |

What is missing: there is no check-in today. "Visited a spot" currently means "finished a game there". Check-ins are the new foundation, so Phase 1 builds them first.

## Benchmarks

What the best apps do and what we take from each.

- **Pokémon Go.** Stops and gyms on a real map, a reason to walk somewhere. Gyms are held until someone beats you, and defenders earn for time held. Niantic shows rough nearby activity, never a live dot on a person, and it bans GPS spoofers in strikes. We take: gyms become King of the Spot, time-held rewards, rough presence instead of exact location, and a strike system for spoofing. We skip: paid items and random rewards.
- **Strava segments and KOM/QOM.** A crown on a fixed course, a leaderboard per segment, and privacy zones that hide the start and end of your route near home. Strava also flags impossible efforts and lets the community flag them. We take: a per-spot leaderboard, the crown on a profile, privacy zones, and flag-for-review. Strava also learned the hard way that crowns on dangerous downhill roads push people to take risks, so we don't rank on speed and we put a hide button on risky spots.
- **Niantic Wayfarer.** Players submit new stops, and other experienced players review them against clear criteria (safe to reach, not private property, not a school). We take: spot submissions reviewed by trusted skaters before a spot can hold a crown or bounty, with the same "safe and public" criteria.

## Phases

Each phase ships behind its own flag, testers first.

### Phase 1: Check-ins and the spot passport

Flag: `VITE_MAP_CHECKINS_ENABLED` (`isMapCheckinsEnabled`).

- Check in at a spot when you are within about 100 m of it. A callable function decides, not the client.
- XP for the first check-in at a new spot, a small amount for repeat check-ins (once per spot per day), tapered like game XP.
- **Spot passport** on the profile: every spot you have checked in at, with the date of your first visit. It is your proof you've been to El Toro, Cherry Park, or the Berrics.
- **Legendary spots:** an admin-curated list (`isLegendary` on the spot). Checking in earns that spot's badge. Earned only, never bought.
- Feed card: "Jason checked in at El Toro" for people who follow you, only if you opt in.

#### Seeding the map

The map needs spots on day one, so seeding is a Phase 1 task.

- **Baseline from OpenStreetMap via the Overpass API.** Skateparks: `leisure=pitch` + `sport=skateboard`, and `leisure=skatepark`. Skate shops: `shop=sports` + `sport=skateboard`, and `shop=skate`. An admin script (`scripts/map/seed_osm.ts`) pulls one region at a time, so we stay inside Overpass's fair-use limits.
- **Attribution.** OSM data is under the ODbL. The map always shows "© OpenStreetMap contributors", and seeded docs keep `source: "osm"` and `osmId` so we can credit the data and refresh it later.
- **Dedupe** against existing spots: matching `osmId`, or a spot within about 50 m with a similar name, gets merged rather than duplicated. User-created spots win, and seeded data only fills in gaps.
- **Seeded spots start unverified** (`isVerified == false`) and go through the same review as user spots before they can hold crowns or bounties.
- **Curated legendary list:** an admin-reviewed file (`scripts/map/legendary_spots.json`) with El Toro, Cherry Park, the Berrics, Hubba Hideout, Love Park, the Brooklyn Banks, Wallenberg, and others. Each entry gets `isLegendary` and a badge. Private spots like the Berrics only get a check-in or challenge with the owner's permission. Until then they're map-only.
- **No scraping of Google Maps or Yelp.** Their terms forbid it. Shops not in OSM get added by the shop or by players through the normal spot submission.

Data model:

- `spots/{spotId}/checkins/{checkinId}`: `uid, createdAt, accuracyM, verdict` (`ok`, `suspect`, `rejected`). Server-written only.
- `users/{uid}/passport/{spotId}`: `spotId, spotName, firstAt, lastAt, count, legendary`. Server-written only, owner-readable. Public view controlled by `passportPublic` on the user.
- `spots/{spotId}`: add `isLegendary`, `legendaryBadgeId`, `checkinCount`, `source` (`user`, `osm`, `curated`), `osmId`, `kind` (`spot`, `park`, `shop`). Admin-only fields.
- Reuses `users/{uid}/xpMarkers/spot_{spotId}` so a first check-in and a first game at a spot share one "new spot" marker.

Rules notes: clients cannot create checkins or passport docs. The `spots/{spotId}` update rule must keep denying `isLegendary`, `legendaryBadgeId`, and `checkinCount` changes from owners. Passport reads: owner always, others only when `passportPublic == true`. Account deletion walks `passport` the same way it walks `xpMarkers`.

Anti-cheat (this phase sets it up for all later phases):

- The callable checks distance, the reported accuracy (reject worse than 150 m), and speed since your last check-in (reject anything faster than a car could drive between spots).
- Cooldown: one check-in per spot per day, and a global cap per hour.
- App Check is required on the callable (see `docs/APPCHECK_ROLLOUT.md`). On native, check mock-location flags (Android `isMock`, iOS simulated location) and mark those `suspect`.
- Strikes like Pokémon Go: suspect check-ins earn nothing, repeated ones block map rewards for a week, then longer. The worst case loses map rewards, never the account or anything already earned elsewhere.

### Phase 2: Live map and nearby challenges

Flag: `VITE_MAP_PRESENCE_ENABLED` (`isMapPresenceEnabled`).

- When you check in, you can choose to show as "skating here" for 2 hours. Default is off.
- Others see a count and avatars on the spot pin, never a dot on your exact position. Presence is tied to the spot, not to where you are standing.
- Tap a skater at a spot and challenge them to S.K.A.T.E. using the existing game flow, which already works from any two locations.
- Privacy zones: you can mark a home area, and nothing near it is ever shown or put on the feed.
- Blocked users never see your presence, and you never see theirs.

Data model:

- `spots/{spotId}/presence/{uid}`: `uid, displayName, avatar, expiresAt`. Server-written by the check-in callable, deleted by the owner or by a TTL policy on `expiresAt`.
- `users/{uid}/private/mapPrivacy`: `showPresence, privacyZones[]` (zones stored as a center rounded to about 500 m plus a radius). Owner only.

Rules notes: presence is readable by signed-in users and filtered against blocks on the client and in the callable. Nobody writes another user's presence. No user's coordinates are stored on any public doc, only the spot id.

### Phase 3: Spot challenges, bounties, and spot submissions

Flags: `VITE_MAP_BOUNTIES_ENABLED`, `VITE_SPOT_REVIEW_ENABLED`.

- **Spot challenges:** a fixed trick list per spot ("kickflip the El Toro 20"). Land it on camera at the spot to get XP and a stamp on that passport page.
- **Bounties:** a player or an admin posts "first to land X here". The reward is XP, a badge, or earned Bucks put up by the poster. Never cash, never random. Proof is a clip judged by the referee.
- **Wayfarer-style spot review:** new spots start unverified. Skaters above a level threshold vote on them using clear rules: public, safe to reach, not a school or private business without permission. Only verified spots can have challenges, bounties, or crowns.

Data model:

- `spots/{spotId}/challenges/{challengeId}`: `trick, createdBy, rewardXp, active`. Admin-written at first.
- `bounties/{bountyId}`: `spotId, postedBy, trick, reward {type, amount}, status, winnerUid, clipId, expiresAt`. Created through a callable that holds the posted Bucks in escrow.
- `spotReviews/{spotId}/votes/{uid}`: `vote, reasons[], createdAt`. One vote per user, written through a callable.

Rules notes: escrow and payout happen only in functions, using the existing closet wallet code. Clients can read bounties but not write status or winner. Review votes are one per uid and immutable.

### Phase 4: King of the Spot

Flag: `VITE_KING_OF_SPOT_ENABLED`.

- Each verified spot has one crown. To take it, you challenge the holder to a crown battle at that spot.
- **Fair format:** the challenger records at the spot (check-in required). The holder answers from anywhere within 48 hours, using the existing S.K.A.T.E. turns, so the holder never has to stay at the spot. If the holder doesn't answer in time, the challenger takes the crown.
- **Judging:** the existing referee and dispute flow. No new judging system.
- **Holding rewards:** XP for each day you hold the crown, with a cap, like a Pokémon Go defender. Holding time and past kings show on the spot and on your profile.
- One crown attempt per spot per day per challenger, and a holder can't be challenged again for a short window after a defense, so nobody gets swarmed.
- A push and a feed card when your crown is taken.

Data model:

- `spots/{spotId}/crown/current`: `holderUid, since, defenses, lastBattleAt`. Server-written only.
- `spots/{spotId}/crownHistory/{id}`: `holderUid, since, until, defenses`.
- Battles are regular `games/{gameId}` docs with `mode: "crown"` and `spotId`, so games, the referee, disputes, and stats all keep working.

Rules notes: crown docs are read-only for clients. The game create rule allows `mode: "crown"` only through the callable that checks the challenger's check-in and the cooldowns.

### Phase 5: Shops, comps, and events

Flags: `VITE_MAP_SHOPS_ENABLED`, `VITE_MAP_EVENTS_ENABLED`.

- **Skate shops as special stops** with their own pin. Checking in at a shop counts for the passport.
- **Sponsored shop challenges:** this is the paid advertising path. A shop pays through Stripe for a featured pin and a challenge ("land a kickflip out front, get 10% off in store"). Shops pay us. Players are never charged and never paid cash. Rewards are in-store perks, XP, and badges.
- Every sponsored item is clearly labeled "Sponsored". Brand logos appear only with that brand's written permission, saved with the shop record.
- **Comps and events:** shops and organizers post events with a time and a spot. They show on the map near the time and as a feed card for nearby skaters who opted in.

Data model:

- `shops/{shopId}`: `name, latitude, longitude, ownerUids[], logoUrl, logoPermissionRef, sponsoredUntil, stripeCustomerId`. Admin-written. Sponsorship is set by a Stripe webhook.
- `events/{eventId}`: `title, spotId | shopId, startsAt, endsAt, postedBy, status`. Created through a reviewed callable, shown only once approved.

Rules notes: only admins and the webhook can write shops. Logo URLs are rejected unless `logoPermissionRef` is set. Events are readable once `status == "approved"`.

### Phase 6: The game look

Flag: `VITE_MAP_GAME_LOOK_ENABLED`.

- Restyle the map with the look from Jason's early art: your avatar skating on the map, shops as wood signs, a crown on King of the Spot pins. Built on the custom Mapbox style (`docs/MAPBOX_STYLE.md`).
- Only once Phases 1 to 4 have real use, because the look is a polish layer and the earlier phases are the part people actually play.

## Feed

Map events go into the existing feed as cards only: check-ins (opt-in), crowns taken, bounties posted and won, legendary badges, nearby events. They group into one card where they can ("3 friends checked in at Cherry Park"). The map has no feed of its own.

## Risks

### Safety: trespassing and traffic

- Wayfarer-style review keeps schools, private property, and road spots without a safe way to reach them off challenges, bounties, and crowns.
- A "report unsafe spot" button. Reports pause rewards at that spot until it's reviewed.
- No rewards based on speed, and no hill bombs or street-traffic challenges. This is the lesson from Strava's downhill KOMs.
- A safety line on check-in and challenge screens: respect the spot, don't skate into traffic, leave if asked.
- Check-ins are disabled above walking or skating speed so nobody checks in while driving.

### Privacy

- Presence is opt-in, tied to a spot rather than a position, and expires after 2 hours.
- Privacy zones near home. The public passport is off by default.
- No coordinates on any public doc. Under-13 users (COPPA) and anyone who hasn't verified their age never appear in presence.
- Update `docs/STORE_PRIVACY_ANSWERS.md` before Phase 2 ships, since precise location use changes the App Store and Play answers.

### Cheating

- Server-side distance, accuracy, and speed checks, App Check, mock-location detection, and cooldowns (Phase 1).
- Strikes that remove map rewards only.
- Crowns and bounties need a clip judged by the referee, so faking a location alone never wins one.
- Farming: XP taper, daily caps, and the same pair of players earning less each time, like game XP today.

### Business and legal

- Brand logos need written permission. The early mockups use real logos (Baker, Thrasher, Vans) as placeholders only.
- Sponsored content is labeled as sponsored.
- Hubba Bucks escrow for bounties uses the closet wallet and never touches cash.

## Rollout

1. Each phase merges with its flag off.
2. Turn it on for Jason and Mike through `config/featureTesters` and the server tester lists.
3. Fix what they find, then turn it on for everyone.
4. Every service ships with 100% test coverage and rules tests for every new collection.

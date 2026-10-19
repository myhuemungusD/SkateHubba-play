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

## Competitor research (Oct 2026)

What skaters say about the apps already out there, and what we change because of it. Ratings and counts are copied from the store pages on the day we checked; we did not estimate any.

| App                        | What it does                                                                                         | Numbers we found                                                                                                                                                                                                                                                    | What users love                                                                                                                                                                                    | Top complaints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ShredSpots                 | Community street-spot and park map, obstacle filters, bust risk, clip feed, contributor leaderboard  | App Store 4.7 (1.2K ratings); Play 4.2 (279 reviews); claims 200k+ skaters, 100k+ spots ([App Store](https://apps.apple.com/us/app/shredspots-find-skate-spots/id1462604065), [Play](https://play.google.com/store/apps/details?hl=en_US&id=com.freeto.free2shred)) | Biggest spot database, fast uploads, obstacle and stair-count filters ([r/skateboardhelp](https://www.reddit.com/r/skateboardhelp/comments/1ketf1k/anyone_know_of_any_skate_spot_apps_out_there/)) | Forced phone number, contacts, GPS, and notifications before you can look at the map; unskippable intro video; SMS login broken for weeks; junk "spots" (any stair or rail); no way to rate or edit others' spots ([reviews](https://apps.apple.com/us/app/shredspots-find-skate-spots/id1462604065?platform=iphone&see-all=reviews))                                                                                                                                                                                                                                                                                                                         |
| Loke                       | Spot map plus brand-backed challenges and an activity graph                                          | App Store 4.3 (169 ratings); claims 96K+ skaters, 51K+ spots in 106 countries ([App Store](https://apps.apple.com/us/app/loke-skate-spots-challenges/id1147539602))                                                                                                 | Brand challenges with real prizes                                                                                                                                                                  | Crashes, freezes, black screens, map and search glitches, slow video, hard to add or edit spots ([JustUseApp](https://justuseapp.com/en/app/1147539602/loke-skate-spots-challenges/reviews))                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Skater XP (2026)           | Closest to us: XP, spot check-ins with Bronze-to-Platinum spot badges, async S.K.A.T.E., ranked jams | App Store 5.0 from 1 rating ([App Store](https://apps.apple.com/us/app/skater-xp/id6762490893))                                                                                                                                                                     | Too new for real feedback                                                                                                                                                                          | No users yet; check-ins have no visible anti-spoof story                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MySkate (UK)               | Park map, check-ins, S.K.A.T.E. with random tricks, event calendar, shop directory                   | 18,884+ Play downloads, last updated Nov 2023 ([chrome-stats](https://chrome-stats.com/d/com.app.myskate))                                                                                                                                                          | S.K.A.T.E. mode is a hit with kids ([Skateboard GB](https://skateboardgb.org/news/myskate-app-updated-skateboard-app-for-2023/))                                                                   | Missing shops with no way to add them; parks vanish from search after edits; abandoned since 2023                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Ride My Park               | Park, spot, and pump-track map for all action sports, sessions, road trips                           | Play 4.5 (240 reviews), 10K+ downloads, last updated May 2024 ([Play](https://play.google.com/store/apps/details?id=com.andrieutom.rmp&hl=en_US))                                                                                                                   | Detailed obstacle and surface info, join sessions                                                                                                                                                  | Stale updates; shares some data with third parties per its Play listing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The Skatepark Project app  | Park finder with advocacy tools                                                                      | 4.7 from 24 ratings; removed from the App Store in Nov 2024 ([AppBrain](https://www.appbrain.com/appstore/the-skatepark-project/ios-1581479702))                                                                                                                    | Trusted park data                                                                                                                                                                                  | Dead: a nonprofit app with no game loop and no reason to open it twice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Pokémon Go                 | Stops and gyms on a real map                                                                         | n/a                                                                                                                                                                                                                                                                 | Real reason to go outside                                                                                                                                                                          | 2017 gym rework: spoofers fed gyms remotely and held them forever, push alerts let multi-account spoofers defend instantly, rural gyms never turned over so defenders earned nothing, solo players locked out ([GamesRadar](https://www.gamesradar.com/the-new-pokemon-go-gym-update-is-live-and-surprise-people-hate-it/), [Kotaku](https://kotaku.com/pokemon-gos-new-gyms-are-off-to-a-rocky-start-1796369786), [r/pokemongo](https://www.reddit.com/r/pokemongo/comments/6lb575/berry_camping_why_the_new_system_only_favors/), [r/TheSilphRoad](https://www.reddit.com/r/TheSilphRoad/comments/5rctz3/discussion_the_defender_bonus_promotes_spoofing/)) |
| Strava                     | Segments, KOM crowns, Flyby                                                                          | n/a                                                                                                                                                                                                                                                                 | Per-segment crowns on your profile                                                                                                                                                                 | Heatmap and segments exposed names on military bases; fake GPS uploads de-anonymized people; Flyby showed strangers' names and home routes until it became opt-in ([WIRED](https://www.wired.com/story/strava-military-bases-area-51-map-afghanistan-gchq-military/), [BleepingComputer](https://www.bleepingcomputer.com/news/security/strava-app-shows-your-info-to-nearby-users-unless-this-setting-is-disabled/), [Strava help](https://support.strava.com/en-us/articles/15401951-privacy-controls))                                                                                                                                                     |
| Monster Hunter Now         | Location hunts, "paintball" a monster to fight later                                                 | n/a                                                                                                                                                                                                                                                                 | Short real-world sessions                                                                                                                                                                          | The most-requested feature is playing with friends who are far away; the game says "too far away" even when people stand together ([community forum](https://community.monsterhunternow.com/t/remove-too-far-away-limitation-when-hunting-paintballed-monsters-via-qr-code-or-in-party/56780), [remote play request](https://community.monsterhunternow.com/t/remote-play-with-friends/217))                                                                                                                                                                                                                                                                  |
| Niantic Wayfarer / Ingress | Players nominate and review real-world stops                                                         | n/a                                                                                                                                                                                                                                                                 | Community-built map                                                                                                                                                                                | Some nominations waited up to 2.5 years; vague rejections and reviewer abuse; no abuse report form until April 2024 ([Wayfarer AMA](https://community.wayfarer.scopely.com/t/wayfarer-ambassador-ama/114), [r/NianticWayfarer](https://www.reddit.com/r/NianticWayfarer/comments/f7ie13/we_need_an_option_to_report_reviewer_abuse/), [abuse form](https://community.wayfarer.scopely.com/t/update-to-our-abuse-report-process-help-center-abuse-report-form/115/1))                                                                                                                                                                                          |

The biggest culture point, from Reddit: skaters keep good street spots quiet because a spot that blows up on an app gets skatestopped or patrolled, and many think public maps only hold "shitty or super famous spots" ([r/skateboardhelp](https://www.reddit.com/r/skateboardhelp/comments/1ketf1k/anyone_know_of_any_skate_spot_apps_out_there/)).

### Changes this research made to the plan

1. **Browse without an account.** The map, spot pages, and legendary spots open with no sign-in and no permissions. Location is asked only when you tap Check in; contacts and phone number are never required. (ShredSpots' top complaint.)
2. **Secret and crew-only spots.** A spot can be public, crew-only, or private. Crew-only spots never appear to strangers, never get seeded into OSM, and never hold public crowns. Spot pages get a "skatestopped / gone" status that anyone can flag. (Spot-blowout fear, dead listings.)
3. **Spot quality, not spot count.** A "gnar" and quality rating, trusted-skater edits of any spot (wiki-style, with history), and duplicate and junk reports. A spot with no check-ins for a year and a "gone" flag gets hidden. (ShredSpots and MySkate junk and stale data.)
4. **Wayfarer with a deadline.** Spot reviews must close in 7 days. If not enough reviewers vote, an admin decides. Rejections always name a reason, and reviewers can be reported. (Wayfarer backlog and abuse.)
5. **Crowns can't be camped.** Holding rewards stop after a cap, a crown with no defense in 14 days becomes open, and the holder must re-check-in at the spot at least once every 14 days to keep it. Crown-taken pushes go to the holder only after the battle ends, so nobody can rally alts mid-fight. (Pokémon Go berry camping and push-alert spoofing.)
6. **Rural spots still pay.** First-ever check-in at a spot nobody has visited in 30 days gives a pioneer bonus, and crowns pay a small one-time take reward so a fast-turnover city crown still feels worth it. (Pokémon Go rural and urban payout complaints.)
7. **Remote friends are a feature, not a bug.** Spot challenges and bounties can be sent to a friend anywhere, using S.K.A.T.E. from any two locations. Only crowns and check-in XP need you physically there. (Monster Hunter Now's top request.)
8. **No Flyby.** We never auto-tag people you passed or show anyone who didn't opt in. Presence is per-spot, opt-in each time, and never stored on your route. (Strava Flyby and heatmap.)
9. **Reliability is a feature.** Phase 1 ships with offline-tolerant check-in (queue and retry), a crash-free target of 99.5% sessions before any flag goes public, and login that doesn't depend only on SMS. (Loke crashes, ShredSpots SMS outage.)
10. **Shops and events need a real owner.** A shop pin is claimed by the shop through a verified flow, and anyone can suggest a missing shop. (MySkate missing shops.)

Research gaps: X, Discord, 4chan /sp/, and GitHub searches were not done in this pass. Store and Reddit feedback were. A follow-up pass should add those.

## Phases

Each phase ships behind its own flag, testers first.

### Phase 1: Check-ins and the spot passport

Flag: `VITE_FEATURE_MAP_CHECKINS` (`isMapCheckinsEnabled`). Server switch: `MAP_CHECKINS_ENABLED` / `MAP_TESTER_UIDS`. Signed-out browsing also needs `config/mapFlags.publicBrowse == true` (Admin SDK only).

**Status (Oct 2026): built.** Callable `mapCheckin` (`functions/src/map/`), client `src/services/mapCheckins.ts`, rules in `firestore.rules`, seed script `scripts/map/seed_osm.mjs`. What shipped, beyond the list below:

- **Browse without an account** when the flag is on and `publicBrowse` is set. Add-spot and check-in ask signed-out visitors to sign in.
- **Location only on tap.** With the flag on, the map never asks for location on open; the prompt appears on Check in or the recenter button.
- **Public, crew-only, or private spots.** Crew-only and private spots live in `privateSpots/{id}` (with `visibility` and `crewUids`, up to 50), never in `spots/`, so a public map query can't return them. They stamp the passport but pay no XP.
- **Offline check-ins.** A check-in that fails for network reasons is saved on the phone (`sh_checkin_queue`) and sent when the signal returns. The server accepts it up to 6 hours late; the `clientId` makes retries safe.
- **Pioneer bonus:** +50 XP for the first check-in at a public spot nobody has checked into for 30 days (never on your own spot). New spot +50, repeat +5, inside the shared 3,000/day XP cap.
- **Seeded spots stay hidden** in the app until the flag is on.

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
- **Curated legendary list:** an admin-reviewed file (`scripts/map/legendary_spots.json`). First batch: Cherry Park, Love Park, EMB, Pier 7, MACBA, Southbank, plus El Toro, Wallenberg, and Hollywood High as map-only (`checkinsAllowed: false`) because they are schools. The Berrics, Hubba Hideout, and the Brooklyn Banks still need confirmed coordinates and permission. Each entry gets `isLegendary` and a badge. Private spots like the Berrics only get a check-in or challenge with the owner's permission. Until then they're map-only.
- **No scraping of Google Maps or Yelp.** Their terms forbid it. Shops not in OSM get added by the shop or by players through the normal spot submission.

Data model:

- `users/{uid}/checkins/{clientId}`: `spotId, scope, verdict (ok | suspect), reason, xp, accuracyM, clientAt, createdAt`. Server-written, owner read/delete. Kept under the user (not the spot) so account deletion removes it.
- `mapState/{uid}`: last accepted fix, hourly count, strikes, `blockedUntil`. Server-written, owner read/delete.
- `passportSettings/{uid}`: `{ public: bool }`, owner-written.
- `privateSpots/{spotId}`: crew-only and private spots (see above).
- `users/{uid}/passport/{spotId}` (private spots: `p_{spotId}`): `spotId, scope, spotName, firstAt (first of the month, UTC), count, legendary`. Server-written only. No exact times or coordinates: the per-day cooldown is an owner-only `users/{uid}/checkins/day.{passportId}.{YYYY-MM-DD}` marker, spot `lastCheckinAt` and legendary `earnedAt` are rounded to the UTC day, and raw fixes live only in owner-only `checkins` and `mapState`. Others can read public-spot stamps only when `passportSettings/{uid}.public` is true.
- `spots/{spotId}`: add `isLegendary`, `legendaryBadgeId`, `checkinCount`, `lastCheckinAt`, `checkinsAllowed`, `source` (`user`, `osm`, `curated`), `osmId`, `kind` (`spot`, `park`, `shop`). Admin-only fields: rules reject them on create and on update.
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

## Spot presence (Oct 18, 2026)

Pokémon Go trainer-battle style challenges. Flag `VITE_FEATURE_SPOT_PRESENCE` (`isSpotPresenceEnabled`), server switch `SPOT_PRESENCE_ENABLED` / `SPOT_PRESENCE_TESTER_UIDS` (default off).

- **Skaters here:** a spot's challenge button is replaced by a list of skaters checked in there right now. Nobody there means nobody to challenge. You must be there too.
- **Server check:** a game created with `spotPresence: true` needs fresh `spotPresence/{spotId}/here/{uid}` docs for both players (firestore.rules). Only the `mapPresence` callable writes them.
- **Day pass:** the first verified check-in of the day (its `day.<spot>.<date>` mark) lets heartbeats re-join you without checking in again. XP is paid only by `mapCheckin`, so re-entries pay nothing.
- **Radius and expiry:** ~500 ft (152 m). Presence lapses 10 minutes after the last heartbeat. Heartbeats every 2 minutes inside, at once on crossing the line, none while away. Mock locations and teleports are refused.
- **Auto check back in:** on by default, switch in Settings → Presence and on the spot card. Off means the watch stops the first time you leave.
- **Online dot:** `onlineStatus/{uid}` heartbeat every 2 minutes while the app is visible: online (<4 min), active recently (<30 min), otherwise nothing. "Hide my online status" stores no time.
- **Foreground only:** no background location plugin is installed, so iOS/Android stop the watch when the app is backgrounded and presence lapses.

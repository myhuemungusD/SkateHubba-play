# Feature flags and testers

Every new feature ships **off**. Testers (today Jason and Mike) see everything through one override, and nobody else sees a feature until its flag is turned on for real.

## How a flag works

- Client flags are `VITE_FEATURE_*` build-time values, read in [`src/lib/featureFlags.ts`](../src/lib/featureFlags.ts). Only the literal string `true` turns one on. Unset, empty, `TRUE` and `false` all mean off.
- `VITE_*` values are baked in when the app is built. A change needs a Vercel redeploy (web) or a new app build (iPhone/Android).
- The list of every client switch lives in [`src/lib/featureSwitches.ts`](../src/lib/featureSwitches.ts). A test fails when it drifts from `featureFlags.ts`. The admin console shows it read-only.
- Client flags only hide screens. The real gate for anything that writes data is the server switch (Cloud Functions parameters, Vercel env) and the Firestore rules.

## The tester override

- Firestore doc `config/featureTesters` holds `{ uids: [...] }`. Only a listed uid (or an admin) can read it, so the list never leaks.
- When a listed tester signs in, [`src/services/featureTesters.ts`](../src/services/featureTesters.ts) stores their uid in local storage (`sh_feature_tester_uid`) and reloads once. From then on every `VITE_FEATURE_*` flag reads as on in that browser or app. Signing out, or a non-tester signing in, clears it.
- The doc is written only from the Firebase console or the Admin SDK. The app never writes it.
- Server features keep their own `*_TESTER_UIDS` lists. `npm run testers:sync` keeps every one of them matched to `config/featureTesters` (dry run by default; `-- --apply` writes). The PR gate runs `node scripts/testers-sync.mjs --check`, so a new `*_TESTER_UIDS` list in code that the script doesn't know about fails CI.
- Pros never get admin powers. Pro tools (`/pro`) only ever act as a verified pro. Admin screens need the admin claim, and the tester override does not grant it.

## Where flags are on today

Rule (Jason, 2026-10-20): every finished feature is on for everyone. A flag stays off only when the feature is unfinished or needs something outside the code first.

- **Code default:** everything off, so a brand-new feature never leaks before it's done.
- **Website (Vercel Production + Preview), iPhone store/TestFlight build (`ios-release.yml`, Xcode Cloud `ci_post_clone.sh`) and server switches (`functions.sk8hub-d7806.env`):** every finished feature on. That covers Map, check-ins, spot presence, tips, Verified Pro (blessing, profiles, showcase, calls, community), Dice (website and server only), XP (website and server only), referee, turn length, trick picker, clip editor, pro camera, clip moderation, feed modes, post makes, profile banner and custom profile, spot chats, Closet (drops, studio, 360 shoes, Hubba icons; trading is website only, off on iPhone until its screen is wired up and proven), and Apple Sign-In on iPhone.
- **Still off for the public, and why:**
  - Skate Runner: waits for Jason's sign-off.
  - Roll Dice in the iPhone build (Jason, 2026-10-20): off for the App Store launch so the listing needs no Simulated Gambling rating. Still on for the website and the server. With it off the iOS app hides the lobby tile, profile Challenge button and `/dice` routes (they redirect), and drops dice toasts and bell rows. Turning it on later means an app update through review.
  - Pro blessing UI in the iPhone build (Jason, 2026-10-21): `VITE_FEATURE_PRO_BLESSING=false` in `ios-release.yml` and `ci_post_clone.sh`. Still on for the website and the server (`PRO_BLESSING_ENABLED`). With it off the iOS app hides the bless button on profiles, the "Put on by" line and the accept screen, and the Pro tools card shows only its preview state. Pro status, the gold handle and pro profiles still show on iPhone. A skater blessed from the website accepts there. Turning it on later means an app update through review.
  - XP in the iPhone build (Jason, 2026-10-23): `VITE_FEATURE_XP_ENABLED=false` in `ios-release.yml` and `ci_post_clone.sh` for 1.2.0. Still on for the website and the server (`XP_ENABLED`), so iPhone games keep earning XP in the background. With it off the iOS app hides the level chip, the XP bar, the achievements ribbon and the game-over level-up, and the check-in toast and map tip stop mentioning XP. `android-aab.yml` still says `"true"` (iPhone-only launch); line it up before the first Play Store build. Turning it on later means an app update through review.
  - What's That Trick: its scoring jobs are still stubs.
  - Buying Hubba Bucks (`CLOSET_BUCKS_PURCHASE_ENABLED`): needs in-app purchase products set up in App Store Connect first.
  - SMS two-step sign-in: not built for iPhone yet.
  - Apple Sign-In on the website: needs a separate Apple web Service ID.
  - Admin screens: admin claim only, never a flag.
- **Clip moderation** needs the Google Video Intelligence API on project `sk8hub-d7806` (enabled 2026-10-20). Without it every new clip waits for manual review.
- **Testers:** everything, including the features above that are still off.

## Client flags

| Flag                                         | What it shows                                                                                                                            | Server switch / notes                                               | Doc                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| `VITE_FEATURE_EXTRAS_ENABLED`                | Map (`/map`, `/spots/:id`), Clips feed (`/feed`), Verified Pro                                                                           | On for the website and iPhone store builds                          | [README](../README.md#environment-variables)         |
| `VITE_FEATURE_APPLE_SIGNIN_ENABLED`          | Sign in with Apple button                                                                                                                | On in iPhone builds                                                 | [IOS_RELEASE.md](IOS_RELEASE.md)                     |
| `VITE_FEATURE_TIPS`                          | Hesher's per-screen tip bubbles, plus "Show tips" and "Replay tips" in Settings                                                          | None (client only). On for website + iPhone store. Never on camera  | `src/components/tips/`                               |
| `VITE_FEATURE_MAP_CHECKINS`                  | Verified check-ins, spot passport, legendary spots, crew/private spots, seeded OpenStreetMap spots                                       | Client on for store/web. Server: `MAP_CHECKINS_ENABLED` / testers   | [MAP_ROADMAP.md](MAP_ROADMAP.md)                     |
| `VITE_FEATURE_SPOT_PRESENCE`                 | Spot presence: challenge only skaters checked in at a spot, day pass with auto re-check-in, online dots, the Who's skating sheet on Home | Client on for store/web. Server: `SPOT_PRESENCE_ENABLED` / testers  | [MAP_ROADMAP.md](MAP_ROADMAP.md)                     |
| `VITE_FEATURE_SPOT_CHATS_ENABLED`            | Spot group chats with report, block, word filter and rate limits                                                                         | Firestore rules                                                     |                                                      |
| `VITE_FEATURE_RUNNER_ENABLED`                | Skate Runner (`/play/runner`) and its lobby card. **Testers only** until Jason signs off on it                                           | None (no Firestore writes)                                          | [RUNNER.md](RUNNER.md)                               |
| `VITE_FEATURE_DICE_ENABLED`                  | Roll Dice                                                                                                                                | `DICE_ENABLED` / `DICE_TESTER_UIDS`                                 | [DICE.md](DICE.md)                                   |
| `VITE_FEATURE_XP_ENABLED`                    | XP, levels and the achievements ribbon                                                                                                   | `XP_ENABLED` / `XP_TESTER_UIDS` (functions and Vercel)              | [XP_LEVELS.md](XP_LEVELS.md)                         |
| `VITE_FEATURE_REFEREE_ENABLED`               | Nominate a referee on a new game                                                                                                         | Read at create time only                                            | [GAME_MECHANICS.md](GAME_MECHANICS.md)               |
| `VITE_FEATURE_TURN_LENGTH`                   | Turn length picker on a new challenge (24 hours, 3 days or 7 days). **Testers only** by default                                          | Read at create time; stored on the game doc                         | [GAME_MECHANICS.md](GAME_MECHANICS.md)               |
| `VITE_FEATURE_TRICK_PICKER_ENABLED`          | Searchable trick picker when setting a trick                                                                                             |                                                                     |                                                      |
| `VITE_FEATURE_CLIP_MODERATION_ENABLED`       | Hold public uploads until moderation clears them                                                                                         | `MODERATION_ENABLED`                                                | [CLIP_MODERATION.md](CLIP_MODERATION.md)             |
| `VITE_FEATURE_CLIP_EDITOR`                   | Clip editor (speed ramps, trims, VX/VHS looks, music, skate sounds)                                                                      |                                                                     | [CLIP_EDITOR.md](CLIP_EDITOR.md)                     |
| `VITE_FEATURE_PRO_CAMERA`                    | Pro camera (4K60, slow-mo, lens switch, tap-to-focus, pre-roll, fisheye)                                                                 |                                                                     | [CAMERA.md](CAMERA.md)                               |
| `VITE_FEATURE_WTT_ENABLED`                   | What's That Trick "Name It" mode in the clips feed                                                                                       | `WTT_ENABLED`. Scoring crons in `api/cron/` are stubs, not deployed |                                                      |
| `VITE_FEATURE_FEED_MODES_ENABLED`            | Feed mode switcher (Scroll / Name It / Vote / Judge)                                                                                     |                                                                     |                                                      |
| `VITE_FEATURE_POST_MAKES_ENABLED`            | "Post your makes" on the game-over screen                                                                                                |                                                                     |                                                      |
| `VITE_FEATURE_PRO_BLESSING`                  | Put someone on, "Put on by", turned-pro screen                                                                                           | `PRO_BLESSING_ENABLED` / `PRO_BLESSING_TESTER_UIDS`. Off on iPhone  | [PRO_BLESSING.md](PRO_BLESSING.md)                   |
| `VITE_FEATURE_PRO_PROFILES`                  | Public pro showcase (hero, bio, sponsors, signature tricks). Admins always see it                                                        | On in iPhone builds                                                 | [PRO_BLESSING.md](PRO_BLESSING.md)                   |
| `VITE_FEATURE_PRO_SHOWCASE`                  | Pro Clip Reel and Pro Spots on pro profiles                                                                                              |                                                                     |                                                      |
| `VITE_FEATURE_PRO_CALLS`                     | Pro tools: review queue and gold clip authoring (verified pros only)                                                                     | Firestore rules + `proReviewOnCreate` / `proGoldOnCreate`           |                                                      |
| `VITE_FEATURE_PRO_COMMUNITY`                 | Pro tools: pro challenges, pro props, featured clips (verified pros only)                                                                | Firestore rules                                                     |                                                      |
| `VITE_FEATURE_PROFILE_BANNER`                | Profile background photo                                                                                                                 |                                                                     | [PROFILE_CUSTOM.md](PROFILE_CUSTOM.md)               |
| `VITE_FEATURE_PROFILE_CUSTOM`                | Customizable profiles (theme, section order, pinned clips, links, theme song)                                                            |                                                                     | [PROFILE_CUSTOM.md](PROFILE_CUSTOM.md)               |
| `VITE_FEATURE_CLOSET_ENABLED`                | Closet: earned and bought items, Hubba Bucks wallet                                                                                      | `CLOSET_ENABLED` / `CLOSET_TESTER_UIDS`                             | [ECONOMY.md](ECONOMY.md)                             |
| `VITE_FEATURE_CLOSET_DROPS_ENABLED`          | Drop Day (needs the closet flag too)                                                                                                     | `CLOSET_DROPS_ENABLED`                                              | [ECONOMY.md](ECONOMY.md)                             |
| `VITE_FEATURE_CLOSET_TRADING_ENABLED`        | Trading (needs the closet flag too)                                                                                                      | `CLOSET_TRADING_ENABLED`                                            | [ECONOMY.md](ECONOMY.md)                             |
| `VITE_FEATURE_CLOSET_BUCKS_PURCHASE_ENABLED` | Buying Hubba Bucks (needs the closet flag too)                                                                                           | `CLOSET_BUCKS_PURCHASE_ENABLED`                                     | [ECONOMY.md](ECONOMY.md)                             |
| `VITE_FEATURE_CLOSET_STUDIO`                 | Closet Studio clothes editor (Mike White designs are the starter templates)                                                              |                                                                     | [CLOSET_STUDIO.md](CLOSET_STUDIO.md)                 |
| `VITE_FEATURE_SHOE_360`                      | 360 viewer for Mike White signature shoes                                                                                                |                                                                     | [MIKE_WHITE_COLLECTION.md](MIKE_WHITE_COLLECTION.md) |
| `VITE_FEATURE_SMS_2FA_ENABLED`               | SMS as a second factor for email/password accounts                                                                                       |                                                                     | [MFA_TOTP.md](MFA_TOTP.md)                           |
| `VITE_FEATURE_RANDOM_CHALLENGER`             | "Find me a challenger" button on Home. Picks a random skater client-side and opens the challenge form. Hidden while off                  | None. No server matchmaking yet                                     |                                                      |
| `VITE_FEATURE_ADMIN_CONSOLE`                 | Admin: bans list, user search, feature switches viewer (admin claim only)                                                                | Admin claim                                                         |                                                      |
| `VITE_FEATURE_ADMIN_OPS`                     | Admin: disputes queue with final ruling, audit log (admin claim only)                                                                    | Admin claim                                                         |                                                      |
| `VITE_FEATURE_ADMIN_INSIGHTS`                | Admin: analytics and announcements (in-app banner + push)                                                                                | Admin claim (`adminAnalytics`, `announcementOnCreate`)              |                                                      |

## Server switches

Cloud Functions read their switches from the functions parameter file (`FUNCTIONS_DOTENV` secret for the GitHub workflow, or the local file `scripts/deploy.mjs` copies in). Every `define*` parameter must have a value or the deploy fails. See [DEPLOY_FUNCTIONS.md](DEPLOY_FUNCTIONS.md).

| Switch                                                                                                                    | Feature                 |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `MAP_CHECKINS_ENABLED`, `MAP_TESTER_UIDS`                                                                                 | Map check-ins           |
| `SPOT_PRESENCE_ENABLED`, `SPOT_PRESENCE_TESTER_UIDS`                                                                      | Spot presence           |
| `DICE_ENABLED`, `DICE_TESTER_UIDS`                                                                                        | Roll Dice               |
| `XP_ENABLED`, `XP_TESTER_UIDS`                                                                                            | XP (also in Vercel env) |
| `PRO_BLESSING_ENABLED`, `PRO_BLESSING_TESTER_UIDS`, `PRO_BLESSING_LIMIT`, `_WINDOW_DAYS`, `_MIN_ACCOUNT_DAYS`             | Pro blessing            |
| `CLOSET_ENABLED`, `CLOSET_DROPS_ENABLED`, `CLOSET_TRADING_ENABLED`, `CLOSET_BUCKS_PURCHASE_ENABLED`, `CLOSET_TESTER_UIDS` | Closet                  |
| `MODERATION_ENABLED`                                                                                                      | Clip moderation         |

## Adding a flag

1. Add the `isXxxEnabled()` reader to `featureFlags.ts` using `flagOn(...)`, so the tester override covers it.
2. Add the key to `featureSwitches.ts`, `src/vite-env.d.ts` and `src/lib/env.ts`, and a commented line to `.env.example`.
3. If it has a server tester list, name it `*_TESTER_UIDS` so `testers:sync` finds it.
4. Add a row to the table above.

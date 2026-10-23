# Store review kit

Two commands that get SkateHubba ready for App Review and Google Play review: a demo reviewer account with real-looking content, and screenshots at every store size.

## 1. Demo reviewer account: `npm run review:seed`

```bash
# PowerShell: $env:REVIEW_EMAIL="..."; $env:REVIEW_PASSWORD="..."
REVIEW_EMAIL=review@skatehubba.com REVIEW_PASSWORD='a-long-password' npm run review:seed
npm run review:seed -- --dry-run      # list what it would write, change nothing
npm run review:seed -- --emulator     # seed the local emulators instead (for screenshots)
```

- Credentials come only from your environment. They are never committed or printed. Use the same email and password in App Store Connect → App Review Information and Play Console → App access.
- It signs in to `sk8hub-d7806` (database `skatehubba`) with Application Default Credentials (`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`), the same as the other admin scripts.
- Set `REVIEW_STORAGE_BUCKET` too. The seed uploads the demo clip to `review-kit/sh-video-edit.mp4` in that bucket, because the game screen only plays videos stored in Firebase Storage. Without it the seed warns, and the in-progress game shows "No video recorded".
- It creates the account, or resets its password if it already exists. Then it writes:
  - a profile (`@appreview`, or `REVIEW_USERNAME`) with stats, XP (level 11), the tutorial marked done, and badges that match the stats
  - six demo opponents
  - nine S.K.A.T.E. games, so Home is full: four on you (two to match, two to set), two waiting on them, and three finished (two wins, one loss)
  - eight landed clips in the feed (`--emulator` only)
  - six spots near Apple Park, plus three public Spot Passport check-ins (`--emulator` only)
  - four Mike White shoes in the Closet (one equipped). They show "Designed by Mike White" in the app. Closet is off in the 1.2.0 iPhone build, so these only appear once Closet ships, and the 1.2.0 listing and screenshots leave Closet out.
- **Production gets no public demo content.** Without `--emulator` the seed skips the feed clips, the map spots and the passport check-ins, because every real user would see them. App Review browses the real feed and map like everyone else.
- Every document has a fixed id, so running it again refreshes the account instead of duplicating it.
- **Gated features:** the reviewer is _not_ added to `config/featureTesters`, so App Review sees exactly what the public gets. Roll Dice and Skate Runner are hidden in the iPhone launch build, so nothing is seeded for them.

## 2. Screenshots: `npm run review:screenshots`

```bash
REVIEW_EMAIL=... REVIEW_PASSWORD=... npm run review:screenshots
npm run review:screenshots -- --only ios-6.9,ios-6.3
npm run review:screenshots -- --base-url http://localhost:5173 --out ./shots
```

It signs in as the reviewer with Playwright (`npx playwright install chromium` once), then saves the screens below at each size into `store-screenshots/<size>/` (gitignored), in store order: `01-game` (a game mid-turn), `02-record` (your record), `03-vs-you` (head-to-head with kai), `04-passport` (spot passport), `05-lobby` (the turn stack) and, optionally, `06-clock` (the challenge form's turn length; leave it out with `--skip-optional`). Each one backs a promise in the iOS listing. Before every shot it stops if the page is on `/dice`, `/play/runner`, `/map`, `/feed`, `/closet` or `/trading`, shows "temporarily unavailable", "No video recorded", "Something went wrong", Roll Dice, Skate Runner or blessing, or has a dialog, sheet or toast open. Set `REVIEW_BROWSER_CHANNEL=chrome` to capture with Google Chrome, which plays the H.264 demo clip (Playwright's own Chromium can't).

| id         | Store       | Device      | Pixels    |
| ---------- | ----------- | ----------- | --------- |
| ios-6.9    | App Store   | iPhone 6.9" | 1320×2868 |
| ios-6.5    | App Store   | iPhone 6.5" | 1284×2778 |
| ios-5.5    | App Store   | iPhone 5.5" | 1242×2208 |
| play-phone | Google Play | Phone       | 1080×1920 |
| play-7in   | Google Play | 7" tablet   | 1200×1920 |
| play-10in  | Google Play | 10" tablet  | 1600×2560 |

Run `review:seed` first so the screens have content. These are captures of the web build at device size. Look them over before uploading, because the native status bar isn't included.

### App Store set, without touching production

The App Store set is `ios-6.9` (1320×2868, the source set) and `ios-6.3` (1206×2622, the 6.3" size Apple lists as required). The app is iPhone-only, so there is no iPad set. Capture it from a local build with the iPhone launch flags (from `.github/workflows/ios-release.yml`: everything on except `VITE_FEATURE_DICE_ENABLED`, Skate Runner, Bucks purchase and SMS 2FA), against the emulators:

```bash
npm run emulators                                  # auth, firestore, storage
# start Vite on :5173 with the iOS release flags (no map shot, so no Mapbox token needed)
REVIEW_BASE_URL=http://localhost:5173 npm run review:seed -- --emulator
REVIEW_BASE_URL=http://localhost:5173 REVIEW_BROWSER_CHANNEL=chrome npm run review:screenshots -- --only ios-6.9,ios-6.3
```

An emulator seed turns the tip bubbles off so they don't cover the screens, and the screenshot script serves Storage URLs from the Storage emulator. Check every shot before uploading: only the seeded demo handles, no empty screens, and nothing from the feed, Closet, XP, map, dice, trading or blessing.

# Store review kit

Two commands that get SkateHubba ready for App Review and Google Play review: a demo reviewer account with real-looking content, and screenshots at every store size.

## 1. Demo reviewer account: `npm run review:seed`

```bash
# PowerShell: $env:REVIEW_EMAIL="..."; $env:REVIEW_PASSWORD="..."
REVIEW_EMAIL=review@skatehubba.com REVIEW_PASSWORD='a-long-password' npm run review:seed
npm run review:seed -- --dry-run      # list what it would write, change nothing
```

- Credentials come only from your environment. They are never committed or printed. Use the same email and password in App Store Connect → App Review Information and Play Console → App access.
- It signs in to `sk8hub-d7806` (database `skatehubba`) with Application Default Credentials (`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`), the same as the other admin scripts.
- It creates the account, or resets its password if it already exists. Then it writes:
  - a profile (`@appreview`, or `REVIEW_USERNAME`), with the tutorial marked done
  - two demo opponents
  - three S.K.A.T.E. games: your turn, their turn, and a win
  - four landed clips in the feed
  - two spots near Apple Park, so the map has nearby pins while Apple reviews it
- Every document has a fixed id, so running it again refreshes the account instead of duplicating it.
- **Gated features:** the reviewer is *not* added to `config/featureTesters`, so App Review sees exactly what the public gets. Tester-only features like Closet, Dice and map check-ins stay hidden. That's why the Closet isn't seeded: the public build doesn't show it.

## 2. Screenshots: `npm run review:screenshots`

```bash
REVIEW_EMAIL=... REVIEW_PASSWORD=... npm run review:screenshots
npm run review:screenshots -- --only ios-6.9,play-phone
npm run review:screenshots -- --base-url http://localhost:5173 --out ./shots
```

It signs in as the reviewer with Playwright (`npx playwright install chromium` once), then saves the lobby, clips feed, map, profile and settings at each size into `store-screenshots/<size>/` (gitignored):

| id | Store | Device | Pixels |
|---|---|---|---|
| ios-6.9 | App Store | iPhone 6.9" | 1320×2868 |
| ios-6.5 | App Store | iPhone 6.5" | 1284×2778 |
| ios-5.5 | App Store | iPhone 5.5" | 1242×2208 |
| ipad-13 | App Store | iPad 13" (the app supports iPad: TARGETED_DEVICE_FAMILY 1,2) | 2064×2752 |
| play-phone | Google Play | Phone | 1080×1920 |
| play-7in | Google Play | 7" tablet | 1200×1920 |
| play-10in | Google Play | 10" tablet | 1600×2560 |

Run `review:seed` first so the screens have content. These are captures of the web build at device size. Look them over before uploading, because the native status bar isn't included.

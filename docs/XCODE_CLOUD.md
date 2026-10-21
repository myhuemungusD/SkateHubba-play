# iOS builds on Xcode Cloud

Xcode Cloud builds the iPhone app on Apple's Macs and uploads it to
TestFlight. It does not use GitHub Actions minutes. The Apple Developer
Program includes 25 compute hours a month; a SkateHubba build takes roughly
20 to 30 minutes.

`ios/App/ci_scripts/ci_post_clone.sh` does the same prep as
`.github/workflows/ios-release.yml`: Node 22 from Homebrew, `npm ci`, the web
build with the TestFlight flags, `GoogleService-Info.plist`, `npx cap sync
ios`, automatic signing for team `CI_TEAM_ID`, and version
`package.json` (build `CI_BUILD_NUMBER`). The project uses Swift Package
Manager, so there is no `pod install`. The GitHub Actions/fastlane path is
unchanged and still works when Actions is back.

Facts Apple asks for:

| Field                    | Value                                  |
| ------------------------ | -------------------------------------- |
| Project                  | `ios/App/App.xcodeproj` (no workspace) |
| Scheme                   | `App` (shared, in `xcshareddata`)      |
| Bundle ID                | `com.skatehubba.app`                   |
| App Store Connect app ID | `6821392195`                           |
| Team                     | Jason Hamilton, `2NDS3XJM79`           |

## Important: the first setup needs a Mac

Apple only lets you **start** Xcode Cloud from the Xcode app (Xcode 15 or
newer, macOS only). After the first build, everything below (workflows,
environment variables, build number, starting builds) works on the App Store
Connect website from any computer. Options for the one-time Mac step: a
friend's Mac, an Apple Store-free option like a rented cloud Mac (MacinCloud,
AWS EC2 Mac), or any Mac signed in to your Apple ID for about 15 minutes.

## Step 1. One time, in Xcode on a Mac (Account Holder or Admin)

1. Install Xcode from the Mac App Store and open it.
2. Xcode > Settings > Accounts > **+** > Apple ID. Sign in as the Account Holder.
3. File > Open... clone or open `myhuemungusD/SkateHubba-play` and choose
   `ios/App/App.xcodeproj`. (Running `npm ci && npm run build && npx cap sync
ios` first is optional; it only matters for local builds.)
4. In the scheme picker at the top, make sure **App** is selected.
5. Open the Report navigator (Cmd-9), click **Cloud**, then **Get Started**.
   (Or Product > Xcode Cloud > Create Workflow.)
6. Select the **App** product, click **Next**.
7. In **Review Workflow**, click **Edit Workflow**:
   - **Start Conditions:** remove "Pull Request Changes". Change "Branch
     Changes" to manual only, or delete it and add **Manual Start** (each
     build uses free hours; keep it manual).
   - **Actions:** keep **Archive - iOS**. Set Deployment Preparation to
     **TestFlight and App Store**. Scheme **App**.
   - **Post-Actions:** **+** > **TestFlight Internal Testing**, pick the
     internal group that has you and Mike.
   - **Environment:** latest released Xcode and macOS. Add every variable
     in the table below (tick **Secret** where it says Secret).
   - Click **Save**.
8. Click **Next**. On **Grant Access to Your Source Code**, click
   **Grant Access**. A browser opens GitHub: install the **Xcode Cloud**
   GitHub App on `myhuemungusD` and give it access to `SkateHubba-play`
   (only that repo is fine). Return to Xcode, click **Next**, then **Complete**.
9. Xcode finds the existing app record (`com.skatehubba.app`) automatically.
10. Do **not** start the build yet; do Step 2 first.

## Step 2. App Store Connect website (any computer)

1. Go to appstoreconnect.apple.com > **Apps** > **SkateHubba**.
2. Click the **Xcode Cloud** tab. In the sidebar choose **Settings**, then
   the **Build Number** tab.
3. Click **Edit** next to **Next Build Number**, enter **11** (one more than
   the newest TestFlight build, 10), and **Save**.
4. Sidebar > **Manage Workflows** > the workflow > **...** > **Edit** if you
   still need to add environment variables (Environment section).
5. Back on the Xcode Cloud tab, click **Start Build**, choose the workflow,
   branch `main`, **Start Build**.
6. When it finishes (about 30 minutes), the build shows in TestFlight >
   iOS Builds as 1.1.0 (11). Internal testers get it after Apple's
   processing; answer the export compliance question if asked
   (the app uses no non-exempt encryption).

## Environment variables (workflow > Environment)

The web build bakes these in. Copy each value from the source named. GitHub
secrets cannot be read back once saved, so copy them from Vercel
(skatehubba project > Settings > Environment Variables > Production, click
the eye icon) or from the Firebase console.

| Name                                | Secret?        | Where to copy it from                                                                                                                            |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_APP_URL`                      | No             | GitHub secret / Vercel Production (`https://skatehubba.com`)                                                                                     |
| `VITE_FIREBASE_API_KEY`             | Yes            | Vercel Production, or Firebase console > Project settings > Web app                                                                              |
| `VITE_FIREBASE_AUTH_DOMAIN`         | No             | Vercel Production / Firebase web app config                                                                                                      |
| `VITE_FIREBASE_PROJECT_ID`          | No             | Vercel Production / Firebase web app config                                                                                                      |
| `VITE_FIREBASE_STORAGE_BUCKET`      | No             | Vercel Production / Firebase web app config                                                                                                      |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | No             | Vercel Production / Firebase web app config                                                                                                      |
| `VITE_FIREBASE_APP_ID`              | No             | Vercel Production / Firebase web app config                                                                                                      |
| `VITE_FIREBASE_VAPID_KEY`           | Yes (optional) | Vercel Production / Firebase > Cloud Messaging > Web Push certificates                                                                           |
| `VITE_MAPBOX_TOKEN`                 | Yes            | Vercel Production (same public `pk.` token as GitHub secret, #747)                                                                               |
| `VITE_MAPBOX_STYLE_URL`             | No (optional)  | Vercel Production, if set                                                                                                                        |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64`  | Yes            | Firebase console > Project settings > iOS app `com.skatehubba.app` > download `GoogleService-Info.plist`, then paste its base64 (or the raw XML) |

Every finished feature is hard-coded on in `ci_post_clone.sh` (same list as
`ios-release.yml`; see [FEATURE_FLAGS.md](FEATURE_FLAGS.md)). Skate Runner,
Roll Dice, buying Hubba Bucks and SMS two-step sign-in stay off. `VITE_FEATURE_WTT_ENABLED`
is the only optional toggle; leave it unset for store builds. Jason and Mike
see every feature through the `config/featureTesters` override.

Not needed on Xcode Cloud: `ASC_KEY_*`, `MATCH_*`, `APPLE_TEAM_ID`. Apple
signs with cloud-managed certificates and uploads with the team's own access.

## Troubleshooting

- "missing variables" in the post-clone log: add the names it lists.
- Signing error: the account that set up Xcode Cloud must be Account Holder
  or Admin so Xcode Cloud can create the cloud distribution certificate.
- Upload rejected for a duplicate build number: raise Next Build Number.

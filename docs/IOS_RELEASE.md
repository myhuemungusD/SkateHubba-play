# iOS release checklist

This is the list of things only a person with the Apple Developer account can do. The app code, the unsigned simulator build, Sign in with Apple, the privacy manifest, and the TestFlight workflow are already in the repo. Do these steps in order. Do not run `.github/workflows/ios-release.yml` until the secrets in step 8 exist — the workflow stops immediately and prints the names of whatever is still missing. It does not sign or upload until those secrets are present.

The EU store deadline in [DSA_COMPLIANCE.md](./DSA_COMPLIANCE.md) has already passed. Items 1–5 there are still open. Finish them before you submit to the App Store, or the app can be pulled from EU storefronts.

## 1. Company paperwork (DSA)

Do these before any store submission. They are the same items tracked in [DSA_COMPLIANCE.md](./DSA_COMPLIANCE.md). None of them can be done from the repo.

1. Confirm the legal entity name and address exactly as they appear on the registration papers. Apple and Dun & Bradstreet match them character for character.
2. Request a D-U-N-S number through Apple’s lookup tool. A lookup is about five business days. A new number can take up to 30 days.
3. Open the Apple support case to convert the Developer account from Individual to Organization. Apple will wait on the D-U-N-S number. Conversion itself takes another two to four weeks, and App Store Connect is restricted while it is in progress. Do not ship a release during that window.
4. Stand up a role mailbox on the skatehubba.com domain (for example legal@ or support@), not a personal Gmail. Add SPF, DKIM, and DMARC so Apple and Google verification mail is not dropped. This address becomes public on the EU product page.
5. After the account shows Organization, declare trader status in App Store Connect (Business → Digital Services Act) and in Google Play Console. Apple and Google each send a code to the address, phone, and email you enter, and they display those details publicly.

## 2. App Store Connect app record

1. In the Apple Developer portal, confirm the App ID is `com.skatehubba.app`.
2. Turn on these capabilities for that App ID. The entitlements are already in the Xcode project. Signing fails if the App ID does not have them:
   - Push Notifications
   - Associated Domains
   - Sign in with Apple
3. In App Store Connect, create the app with bundle ID `com.skatehubba.app` if it does not exist yet.
4. Age rating questionnaire (do this on the app record, not in the repo):
   - Not Made for Kids.
   - The in-app age gate is 13+. Expect a 13+ or 16+ rating because the app has user-recorded video and social features.
   - Unrestricted web access: no.
   - Simulated gambling: no. Roll Dice is compiled out of store builds (`VITE_FEATURE_DICE_ENABLED` is `false`) and there are no chips or cash-out.
   - Encryption: the app only uses HTTPS. `ITSAppUsesNonExemptEncryption` is already `false` in Info.plist, and the TestFlight lane tells App Store Connect the same thing. You should not get the extra encryption paperwork.

## 3. Sign in with Apple in Firebase

Google sign-in is on the landing page and the sign-in screen, so Apple’s rule 4.8 requires Sign in with Apple. The buttons and the native entitlement are already in the app. Firebase still has to be told to accept Apple.

1. Firebase Console → Authentication → Sign-in method → Apple → Enable.
2. For the website (not the iOS app), create a Services ID and a Sign in with Apple key in the Apple Developer portal, and paste the Services ID, Team ID, key ID, and private key into the Firebase Apple provider. Firebase’s Apple setup page lists the exact fields. The iOS app uses the bundle ID; the website uses the Services ID.
3. Add `skatehubba.com` (and any preview domain you sign in from) under Authentication → Settings → Authorized domains.
4. Download `GoogleService-Info.plist` for the iOS app (`com.skatehubba.app`). You will store it as a GitHub secret in step 8. Do not commit the file.
5. The website and Android builds hide the Apple button until you flip it on. After the provider in step 1 is enabled, set `VITE_FEATURE_APPLE_SIGNIN_ENABLED` to the literal `true` in Vercel → Project → Environment Variables and redeploy. Anything else (unset, empty, `TRUE`, `false`) keeps the landing page and the sign-in screen exactly as they are today: Continue with Google, then email. The variable is baked in at build time, so changing it without a redeploy does nothing.
6. App Review needs that button in the iOS store build. The TestFlight workflow (`.github/workflows/ios-release.yml`) sets `VITE_FEATURE_APPLE_SIGNIN_ENABLED=true` for the binary it uploads. Do not run that workflow until step 1 is done. A build with the button on and the Firebase provider off is a broken sign-in for the reviewer. The website flag in step 5 is a separate Vercel change; the store workflow does not turn the website button on.

## 4. Push notifications (APNs)

The app already has the push entitlement (`development` on Debug, `production` on Release) and the background mode. iOS gives the app an APNs token; a small native helper exchanges that for the FCM token the server already sends to Android. That exchange does nothing until Firebase has your APNs key.

1. Apple Developer → Keys → create an APNs key (or reuse the one you already have). Download the `.p8` once.
2. Firebase Console → Project settings → Cloud Messaging → Apple app configuration → upload that APNs key, with its Key ID and your Team ID.
3. The same `GoogleService-Info.plist` from step 3 is what lets the iOS app talk to Firebase. Without it, push registration is skipped and the simulator still launches.

## 5. Universal links and Android App Links

The app claims `https://skatehubba.com` and `https://www.skatehubba.com`. The site serves the association files only when the environment variables below are set. Until then those URLs 404 on purpose, so Apple does not cache a fake Team ID.

1. Vercel → Project → Environment Variables:
   - `APPLE_TEAM_ID` — the 10-character Team ID from Apple Developer → Membership.
   - `ANDROID_SHA256_CERT_FINGERPRINTS` — comma-separated SHA-256 fingerprints. Include the Play App Signing certificate and the upload certificate.
2. Redeploy the site so the variables are live.
3. Confirm these return JSON and do not redirect:
   - `https://skatehubba.com/.well-known/apple-app-site-association`
   - `https://www.skatehubba.com/.well-known/apple-app-site-association`
   - `https://skatehubba.com/.well-known/assetlinks.json`
4. On a phone, a link such as `https://skatehubba.com/me` should open the app after Apple has fetched the file. Apple can take a while to refresh a cached copy.

## 6. Google sign-in URL scheme

`Info.plist` already has the `skatehubba://` scheme used for in-app links. Google sign-in on the phone needs a second URL type, not a replacement.

1. Open `GoogleService-Info.plist` and copy `REVERSED_CLIENT_ID`.
2. Add another entry under `CFBundleURLTypes` in `ios/App/App/Info.plist` whose scheme is that value. Leave the `skatehubba` entry in place.

## 7. Match (the signing-certificate repo)

fastlane match stores the App Store certificate and provisioning profile in a private git repo. CI only reads that repo. It does not create certificates.

1. Create an empty private GitHub repo for the certificates.
2. On a Mac, with the Apple account that should own the cert, run `bundle exec fastlane ios certificates` once with `MATCH_READONLY=false`, `MATCH_GIT_URL`, `MATCH_PASSWORD`, and `APPLE_TEAM_ID` set. That creates the App Store cert and the profile named `match AppStore com.skatehubba.app`.
3. The App ID must already have Push, Associated Domains, and Sign in with Apple (step 2), or the profile will not include them and the signed build will fail.
4. Create a GitHub personal access token that can read the match repo. The secret is base64 of `username:token` (see step 8).

## 8. GitHub Actions secrets

Add these on the SkateHubba repo (Settings → Secrets and variables → Actions). Names must match exactly. Then run the **iOS TestFlight** workflow (`.github/workflows/ios-release.yml`) from the Actions tab. If one is missing, the log lists it and stops before signing.

| Secret                                | What to paste                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `APP_STORE_CONNECT_API_KEY_ID`        | App Store Connect → Users and Access → Integrations → the key’s ID                                          |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | The issuer UUID on that same page                                                                           |
| `APP_STORE_CONNECT_API_KEY`           | The contents of the `.p8` file. Download it once. Newlines can be real newlines or the two characters `\n`. |
| `MATCH_GIT_URL`                       | HTTPS URL of the private match repo                                                                         |
| `MATCH_PASSWORD`                      | The passphrase you chose when you first ran match                                                           |
| `MATCH_GIT_BASIC_AUTHORIZATION`       | Base64 of `github-username:personal-access-token` for the match repo                                        |
| `APPLE_TEAM_ID`                       | 10-character Team ID                                                                                        |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64`    | Base64 of the `GoogleService-Info.plist` file                                                               |
| `VITE_APP_URL`                        | `https://skatehubba.com` (account deletion calls this host from the app)                                    |
| `VITE_FIREBASE_API_KEY`               | Same Firebase web config the site already uses                                                              |
| `VITE_FIREBASE_AUTH_DOMAIN`           | Same                                                                                                        |
| `VITE_FIREBASE_PROJECT_ID`            | Same                                                                                                        |
| `VITE_FIREBASE_STORAGE_BUCKET`        | Same                                                                                                        |
| `VITE_FIREBASE_MESSAGING_SENDER_ID`   | Same                                                                                                        |
| `VITE_FIREBASE_APP_ID`                | Same                                                                                                        |
| `VITE_FIREBASE_VAPID_KEY`             | Same web push key the site already uses                                                                     |

`APPLE_ID` is not required for this workflow. Match uses the API key.

The workflow forces `VITE_FEATURE_DICE_ENABLED=false` and `VITE_FEATURE_APPLE_SIGNIN_ENABLED=true`. Do not add a secret that turns Roll Dice on for a store build. The Apple flag is on only in that store build so App Review sees the button (step 3). The website stays on Google and email until you set the same variable in Vercel.

## 9. What you do after the first green TestFlight upload

1. In App Store Connect, open the build and answer the export-compliance question if it still asks. The answer is that the app does not use non-exempt encryption.
2. Add yourself as a TestFlight tester and sign in with Apple, with Google, and with email. Delete the test account from Settings and confirm it disappears.
3. Confirm a push arrives on a physical iPhone (the simulator build does not receive pushes).
4. When you want App Store review, run `bundle exec fastlane ios release` from a Mac that has the same API key in the environment, or ask for that lane to be added to the workflow later. That submits the latest TestFlight build. It does not run on pull requests.

## Version numbers

The version people see (for example 1.1.0) comes from `package.json` and is bumped by release-please. The build number Apple uses to tell uploads apart is a UTC timestamp (`YYYYMMDDHHMM`) set by the TestFlight lane at build time. It is not committed.

## Account deletion

Settings already has Delete account. On the phone it calls `https://skatehubba.com/api/account/delete` (from `VITE_APP_URL`). The server already allows the native app origins. A store build without `VITE_APP_URL` cannot delete an account, which is why that secret is required above.

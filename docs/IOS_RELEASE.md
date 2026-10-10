# iOS release checklist

You do not need a Mac. GitHub's macOS runner creates the signing certificate, builds the app, and uploads it to TestFlight. Apple sign-in is already on the App ID. The App Store Connect app already exists (Apple ID `6821392195`, SKU `skatehubba-ios`, bundle ID `com.skatehubba.app`). Firebase for that iOS app is already configured.

Do the steps below in order. Do not run the workflows until the secrets exist. Each workflow stops immediately and prints the name of every secret that is still missing. It does not sign or upload until those secrets are present.

The EU store deadline in [DSA_COMPLIANCE.md](./DSA_COMPLIANCE.md) has already passed. Items 1–5 there are still open. Finish them before you submit to the App Store, or the app can be pulled from EU storefronts.

## 1. Create the App Store Connect API key

This key is how GitHub talks to Apple. There is no Apple ID password and no 2FA code.

1. Open [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access** → **Integrations** → **App Store Connect API**.
2. Open **Team Keys** (not an individual key).
3. Click **Generate API Key**. Name it `skatehubba-ci`. Access: **App Manager**. If the form lets you limit the key to the SkateHubba app, do that.
4. Download the `.p8` file when it offers the download. Apple will not show the file again. Keep the file on your computer until the GitHub secret is saved, then delete the loose copy.
5. On that same page, copy two values:
   - **Key ID** — the short id on the key's row. This becomes the `ASC_KEY_ID` secret.
   - **Issuer ID** — the UUID at the top of the page. This becomes the `ASC_ISSUER_ID` secret.
6. The `.p8` file itself becomes the `ASC_KEY_P8` secret. You can paste the file as-is (it starts with `BEGIN PRIVATE KEY`), or paste the base64 of the file. Both work.

App Manager is enough. It can create distribution certificates, create the App Store profile, and upload to TestFlight. Do not use the Developer role. That role cannot create a distribution certificate.

## 2. Create the private certificate repo

fastlane match keeps one Apple Distribution certificate and one App Store provisioning profile, encrypted, in a private git repo. The Xcode project already expects the profile name `match AppStore com.skatehubba.app`. Creating a fresh certificate on every upload is a worse fit: Apple only allows a few distribution certificates on the account, and the next build would not be able to reuse the one you just made. Match creates the certificate once. Later TestFlight runs only read it.

1. On GitHub, create a new repository named `skatehubba-certs` under the **myhuemungusD** account.
2. Set it to **Private**.
3. Check **Add a README** so the repo has a first commit on the `main` branch. An empty repo with no commit cannot be cloned, and the bootstrap will fail.
4. Do not put the SkateHubba app in this repo. It only holds encrypted certificates.
5. The address is `https://github.com/myhuemungusD/skatehubba-certs`. You do not add that address as a secret unless you named the repo something else.

## 3. Create the token that can push to that repo

The bootstrap job has to push the encrypted certificate. The TestFlight job has to read it. One fine-grained token does both. A token in the git URL is refused on purpose, so the token goes in its own secret.

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Resource owner: **myhuemungusD**.
3. Repository access: **Only select repositories** → `skatehubba-certs`.
4. Permissions: **Contents** → **Read and write**. Nothing else.
5. Set an expiration you will remember. When it expires, mint a new token and update the secret. You do not need to create the certificate again.
6. Copy the token once. Then make the secret value, which is the base64 of `myhuemungusD:` immediately followed by the token. Do this on your own computer. Do not paste the token into a website.

PowerShell:

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("myhuemungusD:PASTE_THE_TOKEN_HERE"))
```

Python:

```python
import base64
print(base64.b64encode(b"myhuemungusD:PASTE_THE_TOKEN_HERE").decode())
```

That output is the `MATCH_GIT_BASIC_AUTHORIZATION` secret. It is one line. It is not the token itself.

## 4. Choose the certificate passphrase

Invent a long passphrase and store it in a password manager. That passphrase is the `MATCH_PASSWORD` secret. It encrypts the certificate in the private repo. Apple cannot recover it. GitHub cannot recover it. If you lose it, revoke the distribution certificate in the Apple Developer portal and run the bootstrap again with a new passphrase.

## 5. Add the GitHub secrets

Open the SkateHubba repo → **Settings** → **Secrets and variables** → **Actions** → **Repository secrets** → **New repository secret**. Names must match exactly. Use repository secrets, not environment secrets. The workflows do not look at an environment.

| Secret                             | Where the value comes from                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASC_KEY_ID`                       | App Store Connect → Users and Access → Integrations → App Store Connect API → the Key ID of the App Manager key                                                                                 |
| `ASC_ISSUER_ID`                    | The Issuer ID at the top of that same page                                                                                                                                                     |
| `ASC_KEY_P8`                       | The downloaded `.p8` file. Paste the whole file, including the `BEGIN PRIVATE KEY` line, or paste the base64 of the file                                                                        |
| `MATCH_PASSWORD`                   | The passphrase you invented in step 4                                                                                                                                                           |
| `MATCH_GIT_BASIC_AUTHORIZATION`    | The base64 string from step 3 (`myhuemungusD:` plus the token)                                                                                                                                 |
| `APPLE_TEAM_ID`                    | [Apple Developer](https://developer.apple.com/account) → **Membership** → **Team ID**. Ten characters                                                                                           |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | Firebase Console → Project settings → Your apps → the iOS app `com.skatehubba.app` → download `GoogleService-Info.plist`. Paste the file, or the base64 of the file. Do not commit the file     |
| `VITE_APP_URL`                     | `https://skatehubba.com`                                                                                                                                                                        |
| `VITE_FIREBASE_API_KEY`            | The same Firebase web config the site already uses (Firebase → Project settings → General → the web app, or the existing Vercel variables)                                                     |
| `VITE_FIREBASE_AUTH_DOMAIN`        | Same web config                                                                                                                                                                                 |
| `VITE_FIREBASE_PROJECT_ID`         | Same web config                                                                                                                                                                                 |
| `VITE_FIREBASE_STORAGE_BUCKET`     | Same web config                                                                                                                                                                                 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID`| Same web config                                                                                                                                                                                 |
| `VITE_FIREBASE_APP_ID`             | Same web config                                                                                                                                                                                 |
| `VITE_FIREBASE_VAPID_KEY`          | The same web push key the site already uses                                                                                                                                                     |

`GOOGLE_SERVICE_INFO_PLIST_BASE64` is required because the plist is gitignored and is not in the repo. If a checkout ever already contains `ios/App/App/GoogleService-Info.plist`, the TestFlight workflow keeps that file and does not require the secret.

Leave `MATCH_GIT_URL` unset. The workflows already use `https://github.com/myhuemungusD/skatehubba-certs.git`. Set `MATCH_GIT_URL` only if you created the cert repo at a different address, and use an `https://` URL with no token in it.

The TestFlight workflow forces `VITE_FEATURE_DICE_ENABLED=false` and `VITE_FEATURE_APPLE_SIGNIN_ENABLED=true`. Do not add a secret that turns Roll Dice on for a store build.

## 6. Run the bootstrap once

This creates the distribution certificate and the App Store profile, encrypts them, and pushes them to `skatehubba-certs`. It does not upload an app.

Before you run it, confirm the App ID `com.skatehubba.app` has these capabilities turned on. Push Notifications and Sign in with Apple are already on. **Associated Domains** must be on too, because the app claims `skatehubba.com` and `www.skatehubba.com`. Apple Developer → Identifiers → `com.skatehubba.app`. If Associated Domains is off, the signed build fails later.

1. Merge this change to `main` (or select this branch in the Actions tab if you are trying it before the merge).
2. GitHub → **Actions** → **iOS signing bootstrap** → **Run workflow**.
3. Wait until it is green. Then open `https://github.com/myhuemungusD/skatehubba-certs` and confirm a new commit appeared. The files in that commit are encrypted. That is what you want.
4. Run it again only when the certificate is close to expiring (Apple certificates last about a year) or if the job failed before it pushed. Running it again when the certificate is already in the repo reuses that certificate.

If the job says the account already has the maximum number of distribution certificates, open Apple Developer → Certificates, revoke one you do not use, and run the bootstrap again. Do not revoke a certificate another app is still shipping with.

## 7. Run the TestFlight upload

1. GitHub → **Actions** → **iOS TestFlight** → **Run workflow**.
2. Leave **version** blank to use the version in `package.json` (release-please bumps that). Type a version such as `1.2.0` only when the store version should differ from `package.json`.
3. The job looks up the newest TestFlight build for that version and uploads the next number. The first upload of a version is build 1.
4. It signs with the certificate from the bootstrap. It cannot create a new one.
5. It uploads with pilot and finishes without waiting for Apple to finish processing. "What to Test" is left blank so the job does not sit there waiting. You can type that note in App Store Connect after the build appears.
6. It also tells App Store Connect that the app does not use non-exempt encryption. `ITSAppUsesNonExemptEncryption` is already `false` in Info.plist.

Do not run the bootstrap and the TestFlight workflow at the same time.

If a secret is missing, the log names it and stops. Fix that secret and run the workflow again.

## 8. What you do after the first green upload

These are website clicks. They do not need a Mac.

1. In App Store Connect, wait until the build finishes processing. Open it and answer the export-compliance question if it still asks. The answer is that the app does not use non-exempt encryption.
2. Add yourself as a TestFlight tester. Sign in with Apple, with Google, and with email. Delete the test account from Settings and confirm it disappears.
3. Confirm a push arrives on a physical iPhone. The simulator build does not receive pushes.
4. When you want App Store review, add the processed build to a version in App Store Connect and submit it in the browser. `bundle exec fastlane ios release` does that same submit, and it is not part of the GitHub workflow.

## Company paperwork (DSA)

Do these before any store submission. They are the same items tracked in [DSA_COMPLIANCE.md](./DSA_COMPLIANCE.md). None of them can be done from the repo.

1. Confirm the legal entity name and address exactly as they appear on the registration papers. Apple and Dun & Bradstreet match them character for character.
2. Request a D-U-N-S number through Apple’s lookup tool. A lookup is about five business days. A new number can take up to 30 days.
3. Open the Apple support case to convert the Developer account from Individual to Organization. Apple will wait on the D-U-N-S number. Conversion itself takes another two to four weeks, and App Store Connect is restricted while it is in progress. Do not ship a release during that window.
4. Stand up a role mailbox on the skatehubba.com domain (for example legal@ or support@), not a personal Gmail. Add SPF, DKIM, and DMARC so Apple and Google verification mail is not dropped. This address becomes public on the EU product page.
5. After the account shows Organization, declare trader status in App Store Connect (Business → Digital Services Act) and in Google Play Console. Apple and Google each send a code to the address, phone, and email you enter, and they display those details publicly.

## App Store Connect details that are already done

1. The app record exists. Bundle ID `com.skatehubba.app`, Apple ID `6821392195`, SKU `skatehubba-ios`.
2. Push Notifications and Sign in with Apple are on for that App ID. Confirm Associated Domains is on too (step 6).
3. Age rating questionnaire (on the app record, not in the repo):
   - Not Made for Kids.
   - The in-app age gate is 13+. Expect a 13+ or 16+ rating because the app has user-recorded video and social features.
   - Unrestricted web access: no.
   - Simulated gambling: no. Roll Dice is compiled out of store builds (`VITE_FEATURE_DICE_ENABLED` is `false`) and there are no chips or cash-out.
   - Encryption: the app only uses HTTPS.

## Sign in with Apple in Firebase

Google sign-in is on the landing page and the sign-in screen, so Apple’s rule 4.8 requires Sign in with Apple. The buttons and the native entitlement are already in the app.

1. Firebase Console → Authentication → Sign-in method → Apple → Enable.
2. For the website (not the iOS app), create a Services ID and a Sign in with Apple key in the Apple Developer portal, and paste the Services ID, Team ID, key ID, and private key into the Firebase Apple provider. Firebase’s Apple setup page lists the exact fields. The iOS app uses the bundle ID; the website uses the Services ID.
3. Add `skatehubba.com` (and any preview domain you sign in from) under Authentication → Settings → Authorized domains.
4. The iOS `GoogleService-Info.plist` is the secret in step 5. Do not commit it.
5. The website and Android builds hide the Apple button until you flip it on. After the provider in step 1 is enabled, set `VITE_FEATURE_APPLE_SIGNIN_ENABLED` to the literal `true` in Vercel → Project → Environment Variables and redeploy. Anything else (unset, empty, `TRUE`, `false`) keeps the landing page and the sign-in screen exactly as they are today: Continue with Google, then email. The variable is baked in at build time, so changing it without a redeploy does nothing.
6. App Review needs that button in the iOS store build. The TestFlight workflow sets `VITE_FEATURE_APPLE_SIGNIN_ENABLED=true` for the binary it uploads. Do not run that workflow until step 1 is done. A build with the button on and the Firebase provider off is a broken sign-in for the reviewer. The website flag in step 5 is a separate Vercel change; the store workflow does not turn the website button on.

## Push notifications (APNs)

The app already has the push entitlement (`development` on Debug, `production` on Release) and the background mode. iOS gives the app an APNs token; a small native helper exchanges that for the FCM token the server already sends to Android. That exchange does nothing until Firebase has your APNs key.

1. Apple Developer → Keys → create an APNs key (or reuse the one you already have). Download the `.p8` once. This is a different key from the App Store Connect API key in step 1.
2. Firebase Console → Project settings → Cloud Messaging → Apple app configuration → upload that APNs key, with its Key ID and your Team ID.
3. The same `GoogleService-Info.plist` from step 5 is what lets the iOS app talk to Firebase. Without it, push registration is skipped and the simulator still launches.

## Universal links

The app claims `https://skatehubba.com` and `https://www.skatehubba.com`. The site serves the association files only when the environment variables below are set. Until then those URLs 404 on purpose, so Apple does not cache a fake Team ID.

1. Vercel → Project → Environment Variables:
   - `APPLE_TEAM_ID` — the same 10-character Team ID.
   - `ANDROID_SHA256_CERT_FINGERPRINTS` — comma-separated SHA-256 fingerprints. Include the Play App Signing certificate and the upload certificate.
2. Redeploy the site so the variables are live.
3. Confirm these return JSON and do not redirect:
   - `https://skatehubba.com/.well-known/apple-app-site-association`
   - `https://www.skatehubba.com/.well-known/apple-app-site-association`
   - `https://skatehubba.com/.well-known/assetlinks.json`
4. On a phone, a link such as `https://skatehubba.com/me` should open the app after Apple has fetched the file. Apple can take a while to refresh a cached copy.

## Version numbers

The version people see comes from `package.json` unless you type one in the TestFlight workflow form. Release-please bumps `package.json`. The build number Apple uses to tell uploads apart is one higher than the newest TestFlight build for that version. It is looked up with the API key at build time. It is not committed.

## Account deletion

Settings already has Delete account. On the phone it calls `https://skatehubba.com/api/account/delete` (from `VITE_APP_URL`). The server already allows the native app origins. A store build without `VITE_APP_URL` cannot delete an account, which is why that secret is required above.

## Google sign-in on the phone

The TestFlight lane reads `REVERSED_CLIENT_ID` out of `GoogleService-Info.plist` and adds it as a second URL scheme for that build. The `skatehubba` scheme stays. The lane does not commit the scheme. You do not edit `Info.plist` by hand.

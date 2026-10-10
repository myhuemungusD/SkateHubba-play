# iOS Native Setup — App Store Launch Blockers

The TestFlight workflow installs `GoogleService-Info.plist` from a GitHub
secret and adds the Google sign-in URL scheme while it builds. You do not
do those steps in Xcode, and you do not need a Mac. See
[`docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md). The notes below are what
that workflow is doing, and what is still a portal or phone check.

Status of the three audit blockers:

| #   | Blocker                                              | State                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | App-level privacy manifest (`PrivacyInfo.xcprivacy`) | **DONE** — committed at `ios/App/App/PrivacyInfo.xcprivacy` and wired into the App target's Copy Bundle Resources phase. Nothing to do.                                                                                                                                                                               |
| 2   | Firebase native init                                 | **Guarded in code.** `AppDelegate` calls `SkatehubbaFcm.configureIfPossible()`, which no-ops when `GoogleService-Info.plist` is absent so the simulator still launches. A store build supplies the plist via the `GOOGLE_SERVICE_INFO_PLIST_BASE64` secret. Do not add a second, unguarded `FirebaseApp.configure()`. |
| 3   | Google Sign-In URL scheme (`REVERSED_CLIENT_ID`)     | **Done at build time.** The TestFlight lane reads `REVERSED_CLIENT_ID` from the secret plist and adds a second URL type. It does not commit the value. The `skatehubba` scheme stays in Info.plist. See §4. |

> The plist stays out of git. It has real Firebase credentials. The app
> configures Firebase only when that file is in the bundle, so the
> simulator build still launches without it. The TestFlight workflow is
> what puts the file in the store build.

---

## 1. Add `GoogleService-Info.plist`

1. Firebase console → Project **skatehubba** → Project settings → **Your
   apps** → the iOS app with bundle ID `com.skatehubba.app`.
2. Download **`GoogleService-Info.plist`**.
3. Store it as the `GOOGLE_SERVICE_INFO_PLIST_BASE64` GitHub secret (the
   raw file or its base64). The TestFlight workflow writes
   `ios/App/App/GoogleService-Info.plist` and adds it to the App target
   for that build only.

> This file is **git-ignored**. Do not commit it. The lane copies it into
> the app bundle so Firebase can read it. The unsigned simulator build
> does not have it, and Firebase stays off there on purpose.

## 2. Firebase is already configured, and it will not crash without the plist

`AppDelegate` calls `SkatehubbaFcm.configureIfPossible()` on launch. That
helper lives in the local Swift package `ios/App/SkatehubbaFcm` and calls
`FirebaseApp.configure()` only when `GoogleService-Info.plist` is in the
bundle. The Capacitor Firebase plugins do the same. Do not add another
`FirebaseApp.configure()` call.

The project uses Swift Package Manager (`CapApp-SPM` plus `SkatehubbaFcm`).
There is no Podfile. `npx cap sync ios` refreshes the Capacitor package only.

On a device with the plist installed, launch should not crash and App Check
should attest (no `App Check token` errors in the console).

The iPhone shell keeps Firestore in memory and keeps the Firebase Auth
session in local storage. The IndexedDB-backed versions deadlock WKWebView
during startup and leave the app on the boot spinner. Game data still syncs
while the app is open. A force-quit drops the Firestore cache; the auth
session stays. Android and the website keep the IndexedDB versions.

## 3. Push tokens

iOS push registration returns an APNs token. `SkatehubbaFcm` exchanges it
for an FCM token and the JavaScript stores only that FCM token. This stays
idle until the APNs key is uploaded to Firebase. The steps are in
[`docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md).

---

## 4. Google Sign-In URL scheme

Native `@capacitor-firebase/authentication` sends the user back to the app
with a URL scheme equal to `REVERSED_CLIENT_ID` in
`GoogleService-Info.plist`. The TestFlight lane reads that key and adds it
as a second entry under `CFBundleURLTypes` for the build it uploads. The
`skatehubba` scheme stays. The lane does not commit either change.

The `open(url:)` handler in `AppDelegate.swift` already forwards the
callback to Capacitor. No Swift change is required.

---

## 5. Association files

Both Debug and Release entitlements claim `applinks:skatehubba.com` and
`applinks:www.skatehubba.com`. The site serves the files from
`api/well-known/` when `APPLE_TEAM_ID` and `ANDROID_SHA256_CERT_FINGERPRINTS`
are set on Vercel. Until then those URLs 404. The www host does not redirect
`/.well-known`, because Apple rejects an association file that redirects.

Enable Associated Domains on the App ID or the signed profile will not
include the entitlement. The full order is in
[`docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md).

---

## Final launch smoke test

After the first TestFlight build is installed on a phone:

- [ ] App launches on a physical device with no Firebase / App Check crash.
- [ ] Email/password and Google sign-in both complete and return to the app.
- [ ] Tapping `https://skatehubba.com/me` from Notes/Messages opens the app on
      the profile screen (not Safari / Chrome).
- [ ] App Store Connect **App Privacy** answers match
      `ios/App/App/PrivacyInfo.xcprivacy` (see `docs/STORE_PRIVACY_ANSWERS.md`).

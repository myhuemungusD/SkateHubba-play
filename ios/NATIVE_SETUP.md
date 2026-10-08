# iOS Native Setup — App Store Launch Blockers

This checklist covers the native iOS steps that **cannot be completed in
CI / on Linux** because they require the maintainer's Firebase secret
(`GoogleService-Info.plist`). Do these on a Mac with Xcode 15+ before the
first TestFlight / App Store build. See `ios/README.md` for the general
Capacitor workflow.

Status of the three audit blockers:

| #   | Blocker                                              | State                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | App-level privacy manifest (`PrivacyInfo.xcprivacy`) | **DONE** — committed at `ios/App/App/PrivacyInfo.xcprivacy` and wired into the App target's Copy Bundle Resources phase. Nothing to do.                                                                                                                                                                               |
| 2   | Firebase native init                                 | **Guarded in code.** `AppDelegate` calls `SkatehubbaFcm.configureIfPossible()`, which no-ops when `GoogleService-Info.plist` is absent so the simulator still launches. A store build supplies the plist via the `GOOGLE_SERVICE_INFO_PLIST_BASE64` secret. Do not add a second, unguarded `FirebaseApp.configure()`. |
| 3   | Google Sign-In URL scheme (`REVERSED_CLIENT_ID`)     | **BLOCKED on secret** — add it as a second URL type. The `skatehubba` scheme is already in Info.plist. See §4 below.                                                                                                                                                                                                  |

> **Why these are not fixed in this PR:** `GoogleService-Info.plist`
> contains real project credentials (API key, bundle/client IDs,
> `REVERSED_CLIENT_ID`). We do not fabricate it or invent IDs. Adding a
> `FirebaseApp.configure()` call **without** the plist present makes the
> launch **crash harder** — `configure()` traps when the plist is absent —
> and `@capacitor-firebase/app-check` fails at startup. So the code change
> and the secret must land together, on a Mac, by the maintainer.

---

## 1. Add `GoogleService-Info.plist`

1. Firebase console → Project **skatehubba** → Project settings → **Your
   apps** → the iOS app with bundle ID `com.skatehubba.app`.
2. Download **`GoogleService-Info.plist`**.
3. In Xcode, drag the file into the **`App`** group (next to `Info.plist`).
   In the "Add Files" dialog:
   - **Copy items if needed:** checked.
   - **Add to targets:** **`App`** checked (Target Membership matters — the
     plist must ship inside the app bundle).
4. Confirm it lands on disk at `ios/App/App/GoogleService-Info.plist`.

> This file is **git-ignored / kept out of the repo as a secret**. Do not
> commit it. Distribute it to teammates and CI (fastlane match / a secure
> file) out of band.

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

The iPhone shell uses Firestore's in-memory cache. The persistent cache
deadlocks WKWebView during startup and leaves the app on the boot spinner.
Game data still syncs while the app is open. It does not stay on disk across
a restart. Android and the website keep the persistent cache.

## 3. Push tokens

iOS push registration returns an APNs token. `SkatehubbaFcm` exchanges it
for an FCM token and the JavaScript stores only that FCM token. This stays
idle until the APNs key is uploaded to Firebase. The steps are in
[`docs/IOS_RELEASE.md`](../docs/IOS_RELEASE.md).

---

## 4. Register the Google Sign-In URL scheme in `Info.plist`

Native `@capacitor-firebase/authentication` Google provider redirects back
into the app via a custom URL scheme equal to the **`REVERSED_CLIENT_ID`**
from `GoogleService-Info.plist`. Without it, Google sign-in never returns
to the app.

1. Open the downloaded `GoogleService-Info.plist` and copy the value of the
   `REVERSED_CLIENT_ID` key (looks like
   `com.googleusercontent.apps.1234567890-abcdef...`).
2. Add a **second** dictionary inside the existing `CFBundleURLTypes` array
   in `ios/App/App/Info.plist`. Do not remove the `skatehubba` scheme.

```xml
<dict>
    <key>CFBundleURLSchemes</key>
    <array>
        <string>REVERSED_CLIENT_ID</string>
    </array>
</dict>
```

> The real `REVERSED_CLIENT_ID` is a secret tied to the OAuth client —
> copy it from the plist, do not hardcode a guessed value, and do not
> commit the resolved value if the team treats `Info.plist` client IDs as
> sensitive. (The existing `open(url:)` handler in `AppDelegate.swift`
> already forwards the callback to Capacitor, so no Swift change is needed
> for the URL scheme itself.)

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

After §1–§5 on a Mac:

- [ ] App launches on a physical device with no Firebase / App Check crash.
- [ ] Email/password and Google sign-in both complete and return to the app.
- [ ] Tapping `https://skatehubba.com/me` from Notes/Messages opens the app on
      the profile screen (not Safari / Chrome).
- [ ] App Store Connect **App Privacy** answers match
      `ios/App/App/PrivacyInfo.xcprivacy` (see `docs/STORE_PRIVACY_ANSWERS.md`).

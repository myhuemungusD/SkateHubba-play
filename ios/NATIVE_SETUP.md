# iOS Native Setup — App Store Launch Blockers

This checklist covers the native iOS steps that **cannot be completed in
CI / on Linux** because they require the maintainer's Firebase secret
(`GoogleService-Info.plist`). Do these on a Mac with Xcode 15+ before the
first TestFlight / App Store build. See `ios/README.md` for the general
Capacitor workflow.

Status of the three audit blockers:

| #   | Blocker                                              | State                                                                                                                                   |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | App-level privacy manifest (`PrivacyInfo.xcprivacy`) | **DONE** — committed at `ios/App/App/PrivacyInfo.xcprivacy` and wired into the App target's Copy Bundle Resources phase. Nothing to do. |
| 2   | Firebase native init (`FirebaseApp.configure()`)     | **BLOCKED on secret** — needs `GoogleService-Info.plist`. See §1–§3 below.                                                              |
| 3   | Google Sign-In URL scheme (`REVERSED_CLIENT_ID`)     | **BLOCKED on secret** — needs `GoogleService-Info.plist`. See §4 below.                                                                 |

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

## 2. Call `FirebaseApp.configure()` in `AppDelegate.swift`

`ios/App/App/AppDelegate.swift` currently never configures Firebase. Add
the import and configure call as the **first line** of
`didFinishLaunchingWithOptions` (before Capacitor / plugins touch Firebase):

```swift
import UIKit
import Capacitor
import FirebaseCore   // add this

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        FirebaseApp.configure()   // must run before any Firebase / App Check usage
        // Override point for customization after application launch.
        return true
    }

    // ... rest of the delegate unchanged ...
}
```

Only add the two lines marked above (`import FirebaseCore` and
`FirebaseApp.configure()`). Leave the remaining delegate methods as-is.

## 3. Confirm the Firebase iOS SDK native deps are installed

> ⚠️ **Unverified CocoaPods flow.** The tracked Xcode project uses Swift
> Package Manager (`ios/App/CapApp-SPM/Package.swift`) and has no `Podfile`.
> The `pod install` steps below have not been confirmed against the current
> project — resolve the SPM-vs-CocoaPods question (see `ios/README.md`) with
> Xcode on a Mac before relying on them. If the project stays on SPM, the
> Firebase frameworks resolve through the Swift package and there is no
> `Podfile.lock` to check.

`@capacitor-firebase/authentication` and `@capacitor-firebase/app-check`
ship CocoaPods podspecs that pull the Firebase iOS SDK. After adding the
plist and code:

```bash
npm ci
npm run build
npx cap sync ios          # regenerates Podfile + runs pod install
cd ios/App && pod install --repo-update   # if sync didn't install pods
```

Verify:

1. `ios/App/Podfile.lock` contains `FirebaseCore`, `FirebaseAuth`, and
   `FirebaseAppCheck` (transitive via the Capacitor Firebase plugins).
2. In Xcode, **App → Frameworks, Libraries, and Embedded Content** lists
   the Firebase frameworks.
3. On a device, launch does **not** crash and App Check attests
   successfully (no `App Check token` errors in the console).

---

## 4. Register the Google Sign-In URL scheme in `Info.plist`

Native `@capacitor-firebase/authentication` Google provider redirects back
into the app via a custom URL scheme equal to the **`REVERSED_CLIENT_ID`**
from `GoogleService-Info.plist`. Without it, Google sign-in never returns
to the app.

1. Open the downloaded `GoogleService-Info.plist` and copy the value of the
   `REVERSED_CLIENT_ID` key (looks like
   `com.googleusercontent.apps.1234567890-abcdef...`).
2. Add this `CFBundleURLTypes` block to `ios/App/App/Info.plist` inside the
   top-level `<dict>` (replace `<REVERSED_CLIENT_ID>` with the real value):

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleTypeRole</key>
        <string>Editor</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <string><REVERSED_CLIENT_ID></string>
        </array>
    </dict>
</array>
```

> The real `REVERSED_CLIENT_ID` is a secret tied to the OAuth client —
> copy it from the plist, do not hardcode a guessed value, and do not
> commit the resolved value if the team treats `Info.plist` client IDs as
> sensitive. (The existing `open(url:)` handler in `AppDelegate.swift`
> already forwards the callback to Capacitor, so no Swift change is needed
> for the URL scheme itself.)

---

## 5. Publish the deep-link association files (iOS **and** Android)

The app code and the native config for universal / App Links are already in
place:

- `src/services/nativeApp.ts` → `subscribeToDeepLinks` turns an `appUrlOpen`
  for a `skatehubba.com` https URL into an in-app path; `/game/<id>` reuses
  the existing `OPEN_GAME_EVENT` bridge, other routes navigate.
- `ios/App/App/AppRelease.entitlements` declares
  `com.apple.developer.associated-domains` = `applinks:skatehubba.com`.
- `android/app/src/main/AndroidManifest.xml` has an `android:autoVerify="true"`
  VIEW intent-filter for `https://skatehubba.com` and `https://www.skatehubba.com`.

**Both remaining steps need maintainer-only secrets, so they are NOT in the
repo.** Until they are done, tapped links keep opening the browser.

1. **Apple App Site Association** — create
   `public/.well-known/apple-app-site-association` (no file extension, served
   as `application/json`, no redirect) containing the real **Team ID**:

   ```json
   { "applinks": { "details": [{ "appID": "<TEAMID>.com.skatehubba.app", "paths": ["*"] }] } }
   ```

   Also enable the **Associated Domains** capability on the App ID /
   provisioning profile in the Apple Developer portal — the entitlement alone
   fails code signing without it.

2. **Android asset links** — create `public/.well-known/assetlinks.json` with
   the **release keystore's SHA-256 certificate fingerprint** (and Play App
   Signing's fingerprint if enrolled, both entries):

   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "com.skatehubba.app",
         "sha256_cert_fingerprints": ["<SHA256>"]
       }
     }
   ]
   ```

   Verify afterwards with
   `adb shell pm verify-app-links --re-verify com.skatehubba.app`.

Check `vercel.json` serves `/.well-known/*` untouched by the SPA rewrite
before shipping either file.

---

## Final launch smoke test

After §1–§5 on a Mac:

- [ ] App launches on a physical device with no Firebase / App Check crash.
- [ ] Email/password and Google sign-in both complete and return to the app.
- [ ] Tapping `https://skatehubba.com/me` from Notes/Messages opens the app on
      the profile screen (not Safari / Chrome).
- [ ] App Store Connect **App Privacy** answers match
      `ios/App/App/PrivacyInfo.xcprivacy` (see `docs/STORE_PRIVACY_ANSWERS.md`).

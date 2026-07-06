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

## 3. Confirm the Firebase iOS SDK pods are installed

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

## Final launch smoke test

After §1–§4 on a Mac:

- [ ] App launches on a physical device with no Firebase / App Check crash.
- [ ] Email/password and Google sign-in both complete and return to the app.
- [ ] App Store Connect **App Privacy** answers match
      `ios/App/App/PrivacyInfo.xcprivacy` (see `docs/APP_STORE_PRIVACY.md`).

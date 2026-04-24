# SkateHubba iOS (Capacitor)

This directory holds the Capacitor-generated Xcode project that ships
SkateHubba to the App Store / TestFlight. Most of the files here are produced
by `@capacitor/ios` and should not be edited by hand unless noted below.

## What is tracked in git

- `ios/App/App/Info.plist` — hand-authored. Contains every usage-description
  key Apple reviewers require (camera, mic, photo library, location) plus
  `ITSAppUsesNonExemptEncryption=false` to short-circuit the encryption
  export compliance questionnaire. Keep this in sync with any new Capacitor
  plugin that needs a permission.
- `ios/App/App.xcodeproj/` — the Xcode project. Tracked so signing configs,
  build phases, and asset catalogs stay consistent across machines.
- `ios/App/App/AppDelegate.swift`, `Assets.xcassets/`, `Base.lproj/` —
  standard Capacitor boilerplate, tracked to allow targeted customisation
  (launch storyboard, app icon, splash imageset, etc.).
- `ios/App/CapApp-SPM/Package.swift` — Swift Package Manager manifest
  Capacitor uses to resolve native plugin sources.
- `ios/debug.xcconfig`, `ios/.gitignore` — generated-but-committed.

## What is ignored

See the repository-root `.gitignore` for the canonical list. In short:
`Pods/`, `xcuserdata/`, `build/`, `DerivedData/`, `ios/build/`,
`Podfile.lock` (pending team decision).

## Developer workflow on macOS

The Linux CI environment that initially materialised this directory cannot
run CocoaPods or open Xcode. Finish the setup on a Mac with Xcode 15+ and
CocoaPods installed:

```bash
# 1. Install JS deps + build the web bundle so `dist/` exists.
npm ci
npm run build

# 2. Re-run cap add ios only if ios/ has been nuked. The hand-authored
#    Info.plist in this repo must be preserved — cap add ios will NOT
#    overwrite it when the file already exists on disk, but double-check
#    after the command finishes.
npx cap add ios   # usually skipped; already added in this repo

# 3. Pull the web bundle into ios/App/App/public and install CocoaPods.
npx cap sync ios

# 4. Open in Xcode and configure signing (Team, Bundle Identifier stays
#    com.skatehubba.app). This is a one-time per-Mac action.
npx cap open ios
```

### First-time signing

In Xcode, under _Signing & Capabilities_ for the `App` target:

1. Select the SkateHubba Apple Developer team.
2. Leave _Automatically manage signing_ enabled for local dev builds; CI
   uses fastlane match (see `fastlane/Fastfile`) for release builds.
3. Confirm the bundle ID reads `com.skatehubba.app` — matches
   `capacitor.config.ts` and the `CFBundleIdentifier` entry in `Info.plist`.

### Running on a device / simulator

```bash
npm run cap:run:ios          # wraps `cap run ios`
# or, from Xcode: Cmd+R after selecting a simulator / device.
```

### Releasing to TestFlight

```bash
npm run build && npx cap sync ios
bundle exec fastlane ios beta
```

The `beta` lane expects `App_STORE_CONNECT_API_KEY_PATH` to be exported and
fastlane match credentials to be configured via CI secrets. See
`fastlane/Fastfile` for the full lane definitions.

## When to re-run `npx cap sync ios`

- After any `npm install` that changes a `@capacitor/*` plugin.
- After editing `capacitor.config.ts`.
- After `npm run build` — to refresh `ios/App/App/public/` with the latest
  web bundle before an Xcode build.

`cap sync` is _additive_ for Info.plist: it only touches keys Capacitor
manages. Hand-authored keys (all the `NS*UsageDescription` entries,
`ITSAppUsesNonExemptEncryption`) are preserved across syncs.

## Native Sentry SDK (iOS)

`@sentry/capacitor` (installed via `npm install`) ships a CocoaPods
podspec (`Sentry-Capacitor.podspec`) that is picked up automatically
the first time `npx cap sync ios` runs after the npm install. That
sync regenerates `ios/App/Podfile`, and the subsequent `pod install`
(run implicitly by `cap sync`, or manually via
`cd ios/App && pod install`) pulls in the Sentry Cocoa SDK as a
transitive dependency. No manual Xcode steps are required to link
the framework — the plugin does it for you.

Verify after the first sync:

1. `ios/App/Podfile.lock` contains entries for `Sentry-Capacitor` and
   the upstream `Sentry` cocoa pod.
2. In Xcode, _App → Frameworks, Libraries, and Embedded Content_
   lists the `Sentry.framework` entry — if it is missing after a
   fresh checkout, run `cd ios/App && pod install --repo-update`.
3. At runtime on a physical device, a deliberate
   `Sentry.nativeCrash()` call (exported by `@sentry/capacitor`)
   must surface in the Sentry dashboard as an `ios` platform event
   with a symbolicated Swift stack trace. Swift / Obj-C crashes
   bubble up through the same channel.

Note: the JS-layer init lives in `src/lib/sentry.ts`. The DSN,
release tag (`VITE_APP_VERSION`), and `beforeSend` PII scrubber
defined in `src/main.tsx` are shared across web and native — the
native SDK inherits them via the sibling-SDK init pattern
(`SentryCapacitor.init(opts, SentryReact.init)`).

## Version numbers

`CFBundleShortVersionString` in `Info.plist` is the marketing version and
is currently hardcoded to mirror `package.json` (`1.1.0`). `CFBundleVersion`
is the build number; CI bumps it per TestFlight upload (Phase A4 automation
will wire this up). If you release locally, bump both by hand and commit
the change alongside the `package.json` bump.

## Troubleshooting

- **"No such module 'Capacitor'" in Xcode** — run `npx cap sync ios` and
  reopen the workspace (`App.xcworkspace`, not `.xcodeproj`).
- **Pods out of date** — `cd ios/App && pod install --repo-update`.
- **App crashes on launch with a permission error** — you added a plugin
  that needs a new `NS*UsageDescription`; add it to `Info.plist` and
  re-run `cap sync`.

# SkateHubba iOS (Capacitor)

This directory holds the Capacitor-generated Xcode project that ships
SkateHubba to the App Store / TestFlight. Most of the files here are produced
by `@capacitor/ios` and should not be edited by hand unless noted below.

> **Before the first App Store / TestFlight build:** complete the native
> launch blockers in [`NATIVE_SETUP.md`](./NATIVE_SETUP.md) — they require
> the maintainer's `GoogleService-Info.plist` (a secret) and cannot be done
> in CI. The app-level privacy manifest (`App/PrivacyInfo.xcprivacy`) is
> already committed and wired into the target.

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
`Pods/`, `xcuserdata/`, `build/`, `DerivedData/`, `ios/build/`. There is no
`Podfile.lock` because the project uses Swift Package Manager — see below.

## Native dependency path: Swift Package Manager

The tracked Xcode project resolves native plugins through the local
**Swift Package Manager** package `CapApp-SPM/Package.swift`
(`XCLocalSwiftPackageReference`). There is **no** `Podfile`, `Podfile.lock`,
`Pods/`, or `App.xcworkspace` in the repo — do not run `pod install` and do
not commit a `Podfile.lock`. `npx cap sync ios` regenerates the SPM manifest
from the installed `@capacitor/*` npm packages. If a plugin ever turns out to
be CocoaPods-only, that is a project-structure change to discuss first — see
the hedged note in [`NATIVE_SETUP.md`](./NATIVE_SETUP.md) §3.

## Developer workflow on macOS

The Linux CI environment that initially materialised this directory cannot
open Xcode. Finish the setup on a Mac with Xcode 15+:

```bash
# 1. Install JS deps + build the web bundle so `dist/` exists.
npm ci
npm run build

# 2. Re-run cap add ios only if ios/ has been nuked. The hand-authored
#    Info.plist in this repo must be preserved — cap add ios will NOT
#    overwrite it when the file already exists on disk, but double-check
#    after the command finishes.
npx cap add ios   # usually skipped; already added in this repo

# 3. Pull the web bundle into ios/App/App/public and refresh the SPM manifest.
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

The `beta` lane expects `APP_STORE_CONNECT_API_KEY_PATH` to be exported and
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

`@sentry/capacitor` (installed via `npm install`) is resolved like every
other native plugin: `npx cap sync ios` regenerates
`CapApp-SPM/Package.swift` and SPM pulls in the Sentry Cocoa SDK as a
dependency of the plugin. No manual Xcode steps are required to link the
framework — the plugin does it for you.

Verify after the first sync:

1. `ios/App/CapApp-SPM/Package.swift` lists the Sentry Capacitor plugin,
   and Xcode's package resolution (Project navigator → Package
   Dependencies) shows the upstream `Sentry` package.
2. At runtime on a physical device, a deliberate
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
  reopen `ios/App/App.xcodeproj` (there is no `.xcworkspace` in this
  SPM-based project), then let Xcode re-resolve packages (File → Packages →
  Resolve Package Versions).
- **App crashes on launch with a permission error** — you added a plugin
  that needs a new `NS*UsageDescription`; add it to `Info.plist` and
  re-run `cap sync`.

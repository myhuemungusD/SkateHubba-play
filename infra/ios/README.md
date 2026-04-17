# iOS compliance assets

This folder stages iOS-specific artifacts that need to land inside the
generated `ios/App/App/` folder after `npx cap add ios` is run. The Capacitor
iOS project is intentionally **not** committed to the repo (see
`capacitor.config.ts` — only `android/` is materialised today), so these files
live here until the iOS build is set up on a macOS host.

## Contents

| File                    | Destination                         | Required by                                                               |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `PrivacyInfo.xcprivacy` | `ios/App/App/PrivacyInfo.xcprivacy` | Apple — **mandatory since 1 May 2024** for all new / updated submissions. |

## One-time iOS bring-up

On a macOS host with Xcode + CocoaPods installed:

```bash
# 1. Generate the native iOS project
npx cap add ios
npx cap sync ios

# 2. Copy the staged compliance assets into the project
cp infra/ios/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy

# 3. Add PrivacyInfo.xcprivacy to the Xcode target
#    Xcode → File → Add Files to "App"…
#    Select ios/App/App/PrivacyInfo.xcprivacy
#    Tick "App" target; leave "Copy items if needed" unticked
#    (the file is already in the filesystem)

# 4. Verify by building for a device and running
#    Product → Archive → Validate App
#    The validator will flag any missing reason codes or mis-declared
#    data categories before upload to App Store Connect.
```

Once that's committed, `npx cap sync ios` will keep the iOS project in sync
on every build and the Privacy Manifest will ship automatically.

## Why the manifest lives here (not in `ios/`)

Because `ios/` is generated on first bring-up and currently absent from the
repo, committing `ios/App/App/PrivacyInfo.xcprivacy` directly would create a
"partial" iOS project that confuses Capacitor tooling. Staging in `infra/ios/`
keeps the compliance artifact reviewable in code review and automatable from
CI/Fastlane without checking in the whole Xcode project prematurely.

## Keeping the manifest honest

When any of the following change, update `PrivacyInfo.xcprivacy` in the **same
PR** — App Store reviewers will reject submissions whose declared data surface
drifts from the privacy policy or actual code:

- New Firestore field added to `users/{uid}` that stores personal data
- New third-party SDK added to `package.json` or native dependencies
- Any change to `src/screens/PrivacyPolicy.tsx`
- Any change to permission strings in `ios/App/App/Info.plist` (once that
  file exists)

The pull-request gate (`.github/workflows/pr-gate.yml`) will be wired to
warn when `src/screens/PrivacyPolicy.tsx` changes without a corresponding
edit to `infra/ios/PrivacyInfo.xcprivacy` as part of the iOS bring-up work.

# Android native build — Firebase config

This directory is the Capacitor-generated Android app. Two Firebase config
files must live on disk for native builds to succeed, but **neither is
checked into the repo** — they contain project-specific identifiers that
are not safe to publish and must be pulled from the Firebase Console per
environment.

## google-services.json (Android)

- Download from **Firebase Console → Project settings → General → Your apps
  → Android (`com.skatehubba.app`) → `google-services.json`**.
- Place the file at: `android/app/google-services.json`
- After `npx cap sync android`, the Gradle `com.google.gms.google-services`
  plugin reads this file and wires Firebase Auth, Firestore, Storage, and
  App Check (Play Integrity attestation) into the native SDK.
- CI reconstructs the file from a base64-encoded secret (`GOOGLE_SERVICES_JSON`)
  at build time. Do not commit the plaintext.

## GoogleService-Info.plist (iOS)

- Download from **Firebase Console → Project settings → General → Your apps
  → iOS (`com.skatehubba.app`) → `GoogleService-Info.plist`**.
- Place the file at: `ios/App/App/GoogleService-Info.plist` and ensure it
  is added to the `App` target in Xcode (drag into the Project Navigator).
- Required for native Google Sign-In via `@capacitor-firebase/authentication`
  and for App Check / DeviceCheck attestation.

## Google Sign-In (Android)

`@capacitor-firebase/authentication` uses the native Google Sign-In SDK, which
requires the app's SHA-1 / SHA-256 debug + release signing certificates to be
registered in the Firebase Console (Project settings → General → Your apps →
Android → Add fingerprint). Without those fingerprints the `signInWithGoogle`
native call returns `DEVELOPER_ERROR` (status code 10).

## App Check

- **Release builds (Android):** Play Integrity attestation is automatic once
  `google-services.json` is present and the Play Integrity API is enabled for
  the project in Google Cloud Console.
- **Release builds (iOS):** DeviceCheck attestation is automatic once the
  Apple DeviceCheck private key + team ID are uploaded in the Firebase
  Console under App Check → Apps → iOS.
- **Debug builds:** the app initialises App Check with `debug: true`, which
  prints a debug token on first launch. Paste that token into the Firebase
  Console (App Check → Apps → Manage debug tokens) to whitelist the device
  for testing against a production-enforced backend.
- The opt-in flag `VITE_APPCHECK_ENABLED=true` must be set for App Check to
  initialise at all (same flag gates the web reCAPTCHA v3 flow). Keep it off
  in any environment where App Check has not been fully provisioned — an
  unconfigured enforcement toggle silently rejects every Firestore read.

## Native Sentry SDK (Android)

`@sentry/capacitor` (installed via `npm install`) ships an Android
Gradle module that Capacitor discovers automatically on the first
`npx cap sync android` run after the npm install. The sync updates
`android/app/capacitor.build.gradle` with a
`implementation project(':capacitor-sentry-capacitor')` entry and
appends the module to `android/capacitor.settings.gradle`, so the
next Gradle build (CLI or Android Studio) pulls in the Sentry Android
SDK as a transitive dependency. No manual Gradle edits are required.

Verify after the first sync:

1. `android/capacitor.settings.gradle` lists
   `include ':capacitor-sentry-capacitor'`.
2. `android/app/capacitor.build.gradle` lists the matching
   `implementation project(':capacitor-sentry-capacitor')` line.
3. `./gradlew :app:dependencies | grep sentry` surfaces the upstream
   `io.sentry:sentry-android` artifact (pulled transitively from the
   Capacitor plugin).
4. At runtime on a device, a deliberate `Sentry.nativeCrash()` call
   (exported by `@sentry/capacitor`) must surface in the Sentry
   dashboard as an `android` platform event with a symbolicated
   Kotlin / Java stack trace.

Note: the JS-layer init lives in `src/lib/sentry.ts`. The DSN,
release tag (`VITE_APP_VERSION`), and `beforeSend` PII scrubber
defined in `src/main.tsx` are shared across web and native — the
native SDK inherits them via the sibling-SDK init pattern
(`SentryCapacitor.init(opts, SentryReact.init)`).

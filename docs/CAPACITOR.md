# Capacitor — Play Store Deployment Guide

Step-by-step roadmap for building and shipping SkateHubba as a native Android app via Capacitor.

## Prerequisites

- [Android Studio](https://developer.android.com/studio) installed
- Google Play Developer account ($25 one-time fee)
- Java 17+ (bundled with Android Studio)

## Project Setup (already done)

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/splash-screen
npx cap init  # appId: com.designmainline.skatehubba, webDir: dist
npx cap add android
```

Configuration lives in `capacitor.config.ts` at the project root.

The `android/` directory is **gitignored** — it's generated boilerplate. Regenerate it on first clone:

```bash
npx cap add android
npm run cap:sync
```

## Daily Workflow

After making web code changes:

```bash
npm run cap:sync    # builds web + copies into android/
npm run cap:open    # opens Android Studio
npm run cap:run     # runs on connected device/emulator
```

`cap:sync` = `npm run build && npx cap sync android`. Run it every time before testing on device.

## Step-by-step: First Play Store Release

### 1. Generate app icons and splash screen

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate
```

Place your source images in `assets/` at the project root:
- `icon-only.png` — 1024x1024, no transparency
- `icon-foreground.png` — 1024x1024 with padding for adaptive icon
- `icon-background.png` — 1024x1024 background layer
- `splash.png` — 2732x2732 centered logo
- `splash-dark.png` — dark mode variant

### 2. Set version info

In `android/app/build.gradle`, update:

```groovy
versionCode 1        // increment on every release
versionName "1.0.0"  // semver shown to users
```

### 3. Add camera and audio permissions

The app uses the MediaRecorder web API for video capture. Add these permissions to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

If you later adopt `@capacitor/camera` for native capture, install it then:

```bash
npm install @capacitor/camera
npm run cap:sync
```

### 4. Build the release AAB

In Android Studio:

1. Build > Generate Signed Bundle / APK
2. Select "Android App Bundle"
3. Create a new upload keystore (or use existing)
4. Build the release AAB

**Keep the keystore file safe.** If you lose it, you cannot update the app. Back it up outside the repo. Never commit `.keystore` or `.jks` files.

### 5. Upload to Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Create app > fill in listing details
3. Production > Create release > upload `.aab`

**Required assets for the listing:**

| Asset | Spec |
|---|---|
| App icon | 512x512 PNG |
| Feature graphic | 1024x500 PNG |
| Screenshots | At least 2, phone-sized |
| Privacy policy URL | e.g. skatehubba.com/privacy |
| Short description | Max 80 chars |
| Full description | Max 4000 chars |
| Content rating | Complete the questionnaire (~5 min) |

### 6. Firebase Auth — Authorized Domains

Capacitor loads your app from `localhost` internally. Verify that `localhost` is in your Firebase Console > Authentication > Settings > Authorized domains. It's usually there by default.

## Troubleshooting

- **White screen on device**: Run `npm run cap:sync` — you probably have stale web assets
- **Firebase auth fails**: Check authorized domains include `localhost`
- **Camera not working**: Check AndroidManifest.xml permissions and test on a real device (emulator cameras are unreliable)
- **Build fails in Android Studio**: File > Sync Project with Gradle Files, then try again

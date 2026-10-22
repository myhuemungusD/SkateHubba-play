import type { CapacitorConfig } from "@capacitor/cli";

/**
 * SkateHubba — Capacitor runtime configuration.
 *
 * iOS usage-description strings are NOT configured here. They live in
 * `ios/App/App/Info.plist`; Capacitor's plugin config does not expose them.
 * Required keys for the plugins this app uses:
 *   - NSCameraUsageDescription              (camera preview + video recording)
 *   - NSMicrophoneUsageDescription          (audio track for recorded clips)
 *   - NSLocationWhenInUseUsageDescription   (spot geolocation)
 *
 * The `@capacitor-community/video-recorder` plugin (AVFoundation-backed) uses
 * NSCameraUsageDescription + NSMicrophoneUsageDescription only — no new plist
 * keys beyond the set above.
 *
 * Splash screen assets: generate with `@capacitor/assets` from a 2732×2732
 * master at `resources/splash.png` (dark background) and a 1024×1024 icon at
 * `resources/icon.png`. Run `npx @capacitor/assets generate` after adding
 * those source files — the tool writes the per-density PNGs into `ios/` and
 * `android/` and registers them with the SplashScreen plugin config below.
 *
 * To enable live-reload against the Vite dev server, export `CAP_SERVER_URL`
 * before running `npx cap sync` / `npx cap run`, e.g.:
 *
 *   CAP_SERVER_URL=http://192.168.1.42:5173 npm run cap:run:ios
 */

const isDev = process.env.NODE_ENV !== "production";
const devServerUrl = isDev ? process.env.CAP_SERVER_URL : undefined;

const config: CapacitorConfig = {
  appId: "com.skatehubba.app",
  appName: "SkateHubba",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  android: {
    backgroundColor: "#0A0A0A",
  },
  ios: {
    backgroundColor: "#0A0A0A",
    // "never" so the WKWebView scroll view does not add a second inset on top
    // of CSS env(safe-area-inset-*). initStatusBar() turns overlay on for iOS
    // only, which makes env() report the real notch — the same single inset
    // Safari uses. The global StatusBar.overlaysWebView stays false because
    // Android paints its own status-bar background.
    //
    // The Google app's floating address bar is a separate inset (--overlay-top,
    // src/lib/toolbarOverlay.ts). It is 0 in this shell, so it does not stack
    // on contentInset. See docs/mobile-phone-layout.md.
    contentInset: "never",
  },
  experimental: {
    ios: {
      spm: {
        // Package traits need Swift tools 6.1 in the generated CapApp-SPM.
        swiftToolsVersion: "6.1",
        // @capacitor-firebase/authentication links the Facebook SDK by
        // default (its SPM traits default to Google + Facebook, whatever
        // `providers` says below). The Facebook SDK's privacy manifest
        // declares tracking (NSPrivacyTracking, ep1.facebook.com, Device ID
        // and User ID used for tracking), which contradicts our App Store
        // privacy labels and would need an ATT prompt. Google only: Google
        // sign-in uses the Google trait; Apple sign-in needs no trait.
        packageTraits: {
          "@capacitor-firebase/authentication": ["Google"],
        },
      },
    },
  },
  plugins: {
    FirebaseAuthentication: {
      // The native plugin only fetches a credential; src/services/auth.ts
      // signs into the web Firebase SDK with signInWithCredential, so the
      // native Firebase Auth SDK must not sign in on its own.
      skipNativeAuth: true,
      providers: ["google.com", "apple.com"],
    },
    Keyboard: {
      resize: "native", // keeps fixed bottom sheets above the iOS keyboard
    },
    StatusBar: {
      // Applied natively before the JS bundle runs, so the first frame is
      // already correct; src/services/nativeApp.ts re-asserts the same values
      // at startup. "DARK" = light icons on the dark #0A0A0A shell.
      style: "DARK",
      backgroundColor: "#0A0A0A",
      overlaysWebView: false,
    },
    SplashScreen: {
      // Keep the splash visible until the bundled JS signals ready (via
      // SplashScreen.hide()). `0` on launchShowDuration + manual hide gives
      // us control over when the React tree has actually mounted and we're
      // past the white-flash window Capacitor otherwise shows.
      launchShowDuration: 0,
      launchAutoHide: false,
      launchFadeOutDuration: 300,
      backgroundColor: "#0A0A0A",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      useDialog: false,
    },
  },
};

export default config;

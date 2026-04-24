import type { CapacitorConfig } from "@capacitor/cli";

/**
 * SkateHubba — Capacitor runtime configuration.
 *
 * iOS usage-description strings are NOT configured here. They live in
 * `ios/App/App/Info.plist`; Capacitor's plugin config does not expose them.
 * Required keys for the plugins this app uses:
 *   - NSCameraUsageDescription              (camera preview + video recording)
 *   - NSMicrophoneUsageDescription          (audio track for recorded clips)
 *   - NSPhotoLibraryUsageDescription        (@capacitor/camera fallback flows)
 *   - NSPhotoLibraryAddUsageDescription     (save-to-camera-roll, if ever used)
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
    // Honor iPhone notch + Dynamic Island safe-area insets inside the webview.
    contentInset: "always",
  },
  plugins: {
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
    StatusBar: {
      // Match the dark chrome so the notch bezel blends into the app background.
      style: "DARK",
      backgroundColor: "#0A0A0A",
      overlaysWebView: false,
    },
  },
};

export default config;

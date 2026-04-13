import type { CapacitorConfig } from "@capacitor/cli";

/**
 * SkateHubba — Capacitor runtime configuration.
 *
 * iOS usage-description strings (NSCameraUsageDescription,
 * NSMicrophoneUsageDescription, NSPhotoLibraryUsageDescription,
 * NSLocationWhenInUseUsageDescription, …) are NOT configured here. They live
 * in `ios/App/App/Info.plist`; Capacitor's plugin config does not expose them.
 *
 * To enable live-reload against the Vite dev server, export `CAP_SERVER_URL`
 * before running `npx cap sync` / `npx cap run`, e.g.:
 *
 *   CAP_SERVER_URL=http://192.168.1.42:5173 npm run cap:run:ios
 */

const devServerUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.skatehubba.app",
  appName: "SkateHubba",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https",
    // Only inject a dev URL when explicitly opted in — production builds must
    // load the bundled `dist/` assets so CSP + asset integrity hold.
    ...(devServerUrl ? { url: devServerUrl, cleartext: true } : {}),
  },
  android: {
    // Required so the WebView can load bundled file:// assets alongside
    // https:// Firebase endpoints in the same document.
    allowMixedContent: true,
    backgroundColor: "#0A0A0A",
  },
  ios: {
    backgroundColor: "#0A0A0A",
  },
};

export default config;

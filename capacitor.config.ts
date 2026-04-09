import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.skatehubba.app",
  appName: "SkateHubba",
  webDir: "dist",
  server: {
    // In production builds the app loads from the local bundle.
    // During development you can uncomment the url below to point at
    // your Vite dev server for live-reload (replace with your LAN IP).
    // url: "http://192.168.1.x:5173",
    androidScheme: "https",
  },
  android: {
    // Allow mixed content so the WebView can load local file:// assets
    // alongside https:// Firebase resources during development.
    allowMixedContent: true,
    backgroundColor: "#0A0A0A",
  },
  plugins: {
    Camera: {
      // iOS: include both usage-description keys so the system prompt
      // appears when the app first requests camera or photo-library access.
      "ios.NSCameraUsageDescription": "SkateHubba needs your camera to record trick videos.",
      "ios.NSMicrophoneUsageDescription": "SkateHubba needs your microphone to capture audio with trick videos.",
      "ios.NSPhotoLibraryUsageDescription": "SkateHubba needs photo library access to save trick videos.",
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#0A0A0A",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;

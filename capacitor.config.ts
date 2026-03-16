import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.designmainline.skatehubba",
  appName: "SkateHubba",
  webDir: "dist",
  server: {
    // Capacitor loads from localhost — Firebase Auth needs this in authorized domains
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#0A0A0A",
      showSpinner: false,
      androidSpinnerStyle: "small",
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;

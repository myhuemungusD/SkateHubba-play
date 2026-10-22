import type { FirebaseApp } from "firebase/app";
import { Capacitor } from "@capacitor/core";

/** Fallback lifetime when the plugin omits expireTimeMillis (web SDK refreshes before it). */
const FALLBACK_TOKEN_TTL_MS = 5 * 60_000;

/**
 * App Check for the native shell (iPhone and Android).
 *
 * The native plugin mints the token (App Attest, with DeviceCheck as the
 * fallback, on iPhone; Play Integrity on Android), but every Firestore,
 * Storage and Functions call goes through the web SDK. The web SDK only
 * attaches a token after `initializeAppCheck`, so a CustomProvider bridges
 * the two (the plugin's documented pattern). Without the bridge,
 * enforceAppCheck callables (Closet, pro seed) reject every native call.
 *
 * iPhone: the provider factory is set natively before
 * `FirebaseApp.configure()` (ios/App/SkatehubbaFcm), as Firebase requires,
 * and the simulator uses the debug provider. Calling the plugin's
 * `initialize` here would reset the factory after configure, so iOS only
 * turns on auto-refresh. Android installs its provider at runtime, so it
 * uses `initialize`.
 */
export async function installNativeAppCheck(app: FirebaseApp, debug: boolean): Promise<void> {
  const [{ FirebaseAppCheck }, { initializeAppCheck, CustomProvider }] = await Promise.all([
    import("@capacitor-firebase/app-check"),
    import("firebase/app-check"),
  ]);
  if (Capacitor.getPlatform() === "android") {
    await FirebaseAppCheck.initialize({ debugToken: debug, isTokenAutoRefreshEnabled: true });
  } else {
    await FirebaseAppCheck.setTokenAutoRefreshEnabled({ enabled: true });
  }
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        const { token, expireTimeMillis } = await FirebaseAppCheck.getToken({ forceRefresh: false });
        return { token, expireTimeMillis: expireTimeMillis ?? Date.now() + FALLBACK_TOKEN_TTL_MS };
      },
    }),
    isTokenAutoRefreshEnabled: true,
  });
}

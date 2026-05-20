/// <reference types="vite/client" />

interface ContactInfo {
  name?: string[];
  email?: string[];
  tel?: string[];
}

interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<ContactInfo[]>;
  getProperties(): Promise<string[]>;
}

interface Navigator {
  contacts?: ContactsManager;
}

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_VAPID_KEY?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  /** Opt-in switch for App Check enforcement. Parsed by zod in src/lib/env.ts;
   *  declared here so direct `import.meta.env.VITE_APPCHECK_ENABLED` reads
   *  remain typed. Keep in sync with src/lib/env.ts. */
  readonly VITE_APPCHECK_ENABLED?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  /** Optional Mapbox Studio style URL. Falls back to mapbox://styles/mapbox/dark-v11. */
  readonly VITE_MAPBOX_STYLE_URL?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  /** PostHog project API key (phc_...). Analytics is a no-op when absent. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog host URL. Defaults to https://us.i.posthog.com. */
  readonly VITE_POSTHOG_HOST?: string;
  /** Release tag stamped into Sentry + PostHog at build time. */
  readonly VITE_APP_VERSION?: string;
  /** Git commit SHA from the Vercel build environment. */
  readonly VITE_GIT_SHA?: string;
  readonly VERCEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

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
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VERCEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * firebase-admin bootstrap shared by the crons and `api/account/delete.ts`, so
 * the env parsing, the repair warning and the named database live in one place.
 *
 * The underscore prefix keeps Vercel's filesystem router from exposing this
 * module as an endpoint (see ./_serviceAccount.ts).
 */
import { cert, getApps, initializeApp, type App, type AppOptions } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { parseServiceAccountJson, type ParsedServiceAccount } from "./_serviceAccount.js";

/** Named Firestore database — must match `src/firebase.ts` FIRESTORE_DB_NAME. */
const FIRESTORE_DB_NAME = "skatehubba";

/**
 * The warm app if this process already has one, otherwise a new app from the
 * FIREBASE_SERVICE_ACCOUNT_JSON env var. Throws (caught by the handler) if the
 * env is missing or malformed, so the misconfiguration surfaces as a 500, not a
 * silent no-op. `extraOptions` adds init options derived from the credential;
 * it only runs when a new app is created.
 */
export function adminAppFromEnv(extraOptions?: (account: ParsedServiceAccount) => Omit<AppOptions, "credential">): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  // Tolerates known hand-paste damage (expanded \n escapes, smart quotes) and
  // throws on anything unparseable or missing a field.
  const { account, repaired } = parseServiceAccountJson(raw);
  if (repaired) {
    // Expected error path: the stored env value is damaged but recoverable.
    // Announce it on every cold start so the misconfiguration gets fixed
    // instead of silently absorbed forever.
    console.warn(JSON.stringify({ event: "service_account_json_repaired" }));
  }
  return initializeApp({ credential: cert(account), ...extraOptions?.(account) });
}

/** The named "skatehubba" database, not the project's (default) database. */
export function adminFirestore(app: App): Firestore {
  return getFirestore(app, FIRESTORE_DB_NAME);
}

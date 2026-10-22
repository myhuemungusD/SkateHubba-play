import { doc, getDoc } from "firebase/firestore";
import { requireDb } from "../firebase";
import { FEATURE_TESTER_STORAGE_KEY, isNativeShell } from "../lib/featureFlags";
import { logger } from "./logger";

/**
 * Runtime feature testers. `config/featureTesters` holds `{ uids: string[] }`.
 * Rules only let a listed uid read it, so for everyone else the read is
 * denied and they stay on the default (build-time) flags.
 */
export async function fetchIsFeatureTester(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(requireDb(), "config", "featureTesters"));
    const uids: unknown = snap.exists() ? snap.data().uids : undefined;
    return Array.isArray(uids) && uids.includes(uid);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "permission-denied") {
      logger.warn("feature_testers_read_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(FEATURE_TESTER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(uid: string | null): void {
  try {
    if (uid) localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, uid);
    else localStorage.removeItem(FEATURE_TESTER_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): testers just keep default flags.
  }
}

/**
 * Bring the stored override in line with the signed-in user. Flags are read
 * synchronously during render, so a change reloads the page once; returns
 * true when it did. A non-tester with nothing stored never reloads. Native
 * builds ignore the override (App Store 2.3.1), so there it does nothing.
 */
export async function syncFeatureTester(
  uid: string | null,
  reload: () => void = () => window.location.reload(),
): Promise<boolean> {
  if (isNativeShell()) return false;
  const want = uid && (await fetchIsFeatureTester(uid)) ? uid : null;
  if (want === readStored()) return false;
  writeStored(want);
  if (want === readStored()) {
    reload();
    return true;
  }
  return false;
}

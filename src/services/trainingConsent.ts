/**
 * Opt-in for a future trick recognizer.
 *
 * Default off. Stored on the owner-only private profile, with a policy
 * version and timestamps. Withdrawing writes a `trainingRevocations/{uid}`
 * doc the cron drains to mark existing labels excluded. Players under 18
 * cannot opt in. Under-13s never get an account.
 */

import { doc, getDoc, serverTimestamp, writeBatch, type Timestamp } from "firebase/firestore";
import { requireDb } from "../firebase";
import { ADULT_AGE, getAge } from "../utils/age";
import { PRIVATE_PROFILE_DOC_ID } from "./users";

/** Bump when the training explanation in the privacy policy changes. */
export const TRAINING_CONSENT_POLICY_VERSION = "2026-10-10";

export const TRAINING_REVOCATIONS_COLLECTION = "trainingRevocations";

export class TrainingConsentDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainingConsentDeniedError";
  }
}

export interface TrainingConsentState {
  optedIn: boolean;
  policyVersion: string | null;
  updatedAtMs: number | null;
  revokedAtMs: number | null;
  promptSeenAtMs: number | null;
  dob: string | null;
}

const EMPTY_CONSENT: TrainingConsentState = {
  optedIn: false,
  policyVersion: null,
  updatedAtMs: null,
  revokedAtMs: null,
  promptSeenAtMs: null,
  dob: null,
};

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("toMillis" in value)) return null;
  const toMillis = (value as Timestamp).toMillis;
  if (typeof toMillis !== "function") return null;
  const ms = toMillis.call(value);
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

/** 18 or older, from the private-profile dob (YYYY-MM-DD). Missing or junk dob fails closed. */
export function isAdultForTraining(dob: string | null | undefined, today: Date = new Date()): boolean {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const [year, month, day] = dob.split("-").map((part) => Number(part));
  const born = new Date(year, month - 1, day);
  if (born.getFullYear() !== year || born.getMonth() !== month - 1 || born.getDate() !== day) return false;
  return getAge(born, today) >= ADULT_AGE;
}

/**
 * One-time prompt after a skater's first finished game. Veterans (more than
 * one recorded game) are left alone; they can still use Settings.
 */
export function shouldPromptTrainingConsent(
  consent: TrainingConsentState,
  gamesPlayed: number,
  today: Date = new Date(),
): boolean {
  if (consent.optedIn) return false;
  if (consent.promptSeenAtMs !== null) return false;
  if (!isAdultForTraining(consent.dob, today)) return false;
  return gamesPlayed <= 1;
}

export async function getTrainingConsent(uid: string): Promise<TrainingConsentState> {
  const snap = await getDoc(doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC_ID));
  if (!snap.exists()) return { ...EMPTY_CONSENT };
  const data = snap.data() as Record<string, unknown>;
  return {
    optedIn: data.trainingConsentOptedIn === true,
    policyVersion: typeof data.trainingConsentPolicyVersion === "string" ? data.trainingConsentPolicyVersion : null,
    updatedAtMs: timestampMillis(data.trainingConsentUpdatedAt),
    revokedAtMs: timestampMillis(data.trainingConsentRevokedAt),
    promptSeenAtMs: timestampMillis(data.trainingConsentPromptSeenAt),
    dob: typeof data.dob === "string" ? data.dob : null,
  };
}

export async function setTrainingConsent(uid: string, optedIn: boolean): Promise<void> {
  const current = await getTrainingConsent(uid);
  if (optedIn && !isAdultForTraining(current.dob)) {
    throw new TrainingConsentDeniedError("Players under 18 can't opt in to trick training.");
  }
  const db = requireDb();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID),
    {
      trainingConsentOptedIn: optedIn,
      trainingConsentPolicyVersion: TRAINING_CONSENT_POLICY_VERSION,
      trainingConsentUpdatedAt: serverTimestamp(),
      trainingConsentRevokedAt: optedIn ? null : serverTimestamp(),
    },
    { merge: true },
  );
  // Only a real withdrawal needs the cron. Opting in, or toggling off when
  // they were never in, does not mark clips.
  if (!optedIn && current.optedIn) {
    batch.set(doc(db, TRAINING_REVOCATIONS_COLLECTION, uid), { revokedAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function markTrainingConsentPromptSeen(uid: string): Promise<void> {
  const db = requireDb();
  const batch = writeBatch(db);
  batch.set(
    doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID),
    { trainingConsentPromptSeenAt: serverTimestamp() },
    { merge: true },
  );
  await batch.commit();
}

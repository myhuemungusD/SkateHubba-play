/**
 * Per-screen Hesher tips — seen-state persistence.
 *
 * Same hybrid model as services/onboarding.ts: localStorage is written first
 * (instant, offline-safe) and Firestore `users/{uid}/private/profile` carries
 * `tipsSeen` (tip-set ids) + `tipsDisabled` so the state follows the user to
 * other devices. Every Firestore call is best-effort: failures are logged and
 * never thrown, so a blip never strands a bubble on screen.
 */

import { arrayUnion, doc, getDoc, setDoc } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { PRIVATE_PROFILE_DOC_ID } from "./users";

export interface TipsState {
  seen: string[];
  disabled: boolean;
}

/** Rules cap `tipsSeen` at 64 entries. */
export const MAX_TIPS_SEEN = 64;

const EMPTY: TipsState = { seen: [], disabled: false };

function localKey(uid: string): string {
  return `skatehubba.tips.v1.${uid}`;
}

function cleanSeen(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string").slice(0, MAX_TIPS_SEEN);
}

export function getLocalTips(uid: string): TipsState {
  if (!uid) return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(localKey(uid));
    if (raw === null) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Record<keyof TipsState, unknown>> | null;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    return { seen: cleanSeen(parsed.seen), disabled: parsed.disabled === true };
  } catch (err) {
    logger.warn("tips_local_read_failed", { error: parseFirebaseError(err) });
    return { ...EMPTY };
  }
}

export function setLocalTips(uid: string, state: TipsState): void {
  if (!uid) return;
  try {
    window.localStorage.setItem(
      localKey(uid),
      JSON.stringify({ seen: cleanSeen(state.seen), disabled: state.disabled }),
    );
  } catch (err) {
    logger.warn("tips_local_write_failed", { error: parseFirebaseError(err) });
  }
}

function ref(uid: string) {
  return doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC_ID);
}

async function safeWrite(uid: string, payload: Record<string, unknown>, op: string): Promise<void> {
  try {
    await setDoc(ref(uid), payload, { merge: true });
  } catch (err) {
    logger.warn("tips_write_failed", { op, error: parseFirebaseError(err) });
  }
}

/**
 * Local state merged with the server copy: seen ids are unioned, and the
 * server's `tipsDisabled` wins when it is set. The merge is written back
 * locally so the next load is instant.
 */
export async function loadTips(uid: string): Promise<TipsState> {
  const local = getLocalTips(uid);
  if (!uid) return local;
  try {
    const snap = await getDoc(ref(uid));
    if (!snap.exists()) return local;
    const data = snap.data();
    const merged: TipsState = {
      seen: Array.from(new Set([...local.seen, ...cleanSeen(data.tipsSeen)])).slice(0, MAX_TIPS_SEEN),
      disabled: typeof data.tipsDisabled === "boolean" ? data.tipsDisabled : local.disabled,
    };
    setLocalTips(uid, merged);
    return merged;
  } catch (err) {
    logger.warn("tips_read_failed", { error: parseFirebaseError(err) });
    return local;
  }
}

/** Record that a tip set was finished or dismissed. Returns the new state. */
export async function markTipSeen(uid: string, id: string): Promise<TipsState> {
  const local = getLocalTips(uid);
  if (!uid || !id || local.seen.includes(id)) return local;
  const next: TipsState = { ...local, seen: [...local.seen, id].slice(0, MAX_TIPS_SEEN) };
  setLocalTips(uid, next);
  if (next.seen.includes(id)) await safeWrite(uid, { tipsSeen: arrayUnion(id) }, "markTipSeen");
  return next;
}

/** Settings → "show tips" switch. */
export async function setTipsDisabled(uid: string, disabled: boolean): Promise<TipsState> {
  const next: TipsState = { ...getLocalTips(uid), disabled };
  if (!uid) return next;
  setLocalTips(uid, next);
  await safeWrite(uid, { tipsDisabled: disabled }, "setTipsDisabled");
  return next;
}

/** Settings → "replay tips": forget every seen set and switch tips back on. */
export async function resetTips(uid: string): Promise<TipsState> {
  const next: TipsState = { seen: [], disabled: false };
  if (!uid) return next;
  setLocalTips(uid, next);
  await safeWrite(uid, { tipsSeen: [], tipsDisabled: false }, "resetTips");
  return next;
}

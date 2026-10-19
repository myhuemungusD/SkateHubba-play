/**
 * App-wide online indicator: a small heartbeat to onlineStatus/{uid} while
 * the app is open and visible. Others see "online", "active recently" or
 * nothing. Hiding your status stores no time at all. Never holds a location.
 */
import { doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import * as firebase from "../firebase";
import { logger } from "./logger";

export const HIDE_ONLINE_KEY = "sh_hide_online";
export const ONLINE_BEAT_MS = 2 * 60 * 1000;
export const ONLINE_WINDOW_MS = 4 * 60 * 1000;
export const RECENT_WINDOW_MS = 30 * 60 * 1000;

export type OnlineState = "online" | "recent" | "offline";

export function getHideOnline(): boolean {
  try {
    return localStorage.getItem(HIDE_ONLINE_KEY) === "1";
  } catch {
    return false;
  }
}

export function classifyOnline(lastSeenMs: number | null, nowMs: number = Date.now()): OnlineState {
  if (lastSeenMs === null) return "offline";
  const age = nowMs - lastSeenMs;
  if (age < ONLINE_WINDOW_MS) return "online";
  if (age < RECENT_WINDOW_MS) return "recent";
  return "offline";
}

export async function beatOnline(uid: string, hidden: boolean = getHideOnline()): Promise<void> {
  const ref = doc(firebase.requireDb(), "onlineStatus", uid);
  await setDoc(ref, hidden ? { lastSeen: null, hidden: true } : { lastSeen: serverTimestamp(), hidden: false });
}

export async function setHideOnline(uid: string, hide: boolean): Promise<void> {
  try {
    if (hide) localStorage.setItem(HIDE_ONLINE_KEY, "1");
    else localStorage.removeItem(HIDE_ONLINE_KEY);
  } catch {
    // Storage blocked: the server doc still reflects the choice.
  }
  await beatOnline(uid, hide);
}

/** Beat now, every ONLINE_BEAT_MS while visible, and on return to the app. Returns stop. */
export function startOnlineHeartbeat(uid: string): () => void {
  const beat = () => {
    if (document.visibilityState !== "visible") return;
    beatOnline(uid).catch((err: unknown) => {
      logger.warn("online_beat_failed", { error: err instanceof Error ? err.message : "unknown" });
    });
  };
  beat();
  const timer = setInterval(beat, ONLINE_BEAT_MS);
  document.addEventListener("visibilitychange", beat);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", beat);
  };
}

/** Live online state for one user. Hidden or missing reads as offline. */
export function subscribeOnline(
  uid: string,
  onChange: (state: OnlineState) => void,
  now: () => number = Date.now,
): () => void {
  let lastSeen: number | null = null;
  const emit = () => onChange(classifyOnline(lastSeen, now()));
  const unsub = onSnapshot(
    doc(firebase.requireDb(), "onlineStatus", uid),
    (snap) => {
      const raw = snap.exists() ? snap.data() : null;
      lastSeen = raw && raw.hidden !== true && raw.lastSeen instanceof Timestamp ? raw.lastSeen.toMillis() : null;
      emit();
    },
    () => {
      lastSeen = null;
      emit();
    },
  );
  const timer = setInterval(emit, 60_000);
  return () => {
    clearInterval(timer);
    unsub();
  };
}

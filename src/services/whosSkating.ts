/**
 * "Who's skating": who is at a spot right now, and who was at one lately.
 *
 * Reads skaterActivity, which only the mapPresence callable writes. Each doc
 * names a spot, never a location. Skaters who hid their online status are
 * written with visible: false, and the rules refuse any list that doesn't ask
 * for visible == true, so hidden skaters are filtered on the server.
 */
import { collection, doc, limit, onSnapshot, orderBy, query, Timestamp, updateDoc, where } from "firebase/firestore";
import * as firebase from "../firebase";
import { logger } from "./logger";

/** How far back "Recently" goes. */
export const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Most skaters the sheet loads at once (the rules cap a list at 50). */
export const WHOS_SKATING_LIMIT = 30;

export interface SkaterActivity {
  uid: string;
  username: string;
  spotId: string;
  spotName: string;
  lastAt: number;
  hereUntil: number;
}

export interface WhosSkating {
  /** At a spot right now, newest first. */
  now: SkaterActivity[];
  /** At a spot in the last 24 hours but not now, newest first. */
  recent: SkaterActivity[];
}

function ms(v: unknown): number {
  return v instanceof Timestamp ? v.toMillis() : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Split into "now" and "recently", dropping you, blanks and anything older than the window. */
export function splitActivity(rows: readonly SkaterActivity[], selfUid: string | null, nowMs: number): WhosSkating {
  const out: WhosSkating = { now: [], recent: [] };
  const sorted = [...rows].sort((a, b) => b.lastAt - a.lastAt);
  for (const r of sorted) {
    if (r.uid === selfUid || !r.username || !r.spotId) continue;
    if (r.hereUntil > nowMs) out.now.push(r);
    else if (nowMs - r.lastAt < ACTIVITY_WINDOW_MS) out.recent.push(r);
  }
  return out;
}

/** "just now", "5m ago", "2h ago", "1d ago". */
export function agoLabel(thenMs: number, nowMs: number): string {
  const mins = Math.floor(Math.max(0, nowMs - thenMs) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Live "Who's skating" list. Re-splits every 30 s so someone whose time at a
 * spot runs out moves to "Recently" without a new write. Returns stop.
 */
export function subscribeWhosSkating(
  selfUid: string | null,
  onChange: (list: WhosSkating) => void,
  now: () => number = Date.now,
): () => void {
  let rows: SkaterActivity[] = [];
  const emit = () => onChange(splitActivity(rows, selfUid, now()));
  const q = query(
    collection(firebase.requireDb(), "skaterActivity"),
    where("visible", "==", true),
    where("lastAt", ">", Timestamp.fromMillis(now() - ACTIVITY_WINDOW_MS)),
    orderBy("lastAt", "desc"),
    limit(WHOS_SKATING_LIMIT),
  );
  const unsub = onSnapshot(
    q,
    (snap) => {
      rows = snap.docs.map((d) => {
        const raw = d.data();
        return {
          uid: d.id,
          username: str(raw.username),
          spotId: str(raw.spotId),
          spotName: str(raw.spotName) || "a spot",
          lastAt: ms(raw.lastAt),
          hereUntil: ms(raw.hereUntil),
        };
      });
      emit();
    },
    (err) => {
      logger.warn("whos_skating_list_failed", { code: (err as { code?: string }).code ?? "unknown" });
      rows = [];
      emit();
    },
  );
  const timer = setInterval(emit, 30_000);
  return () => {
    clearInterval(timer);
    unsub();
  };
}

/**
 * Mirror the "hide my online status" choice onto your activity doc right
 * away (the next presence heartbeat would too). No doc yet is fine.
 */
export async function setActivityVisible(uid: string, visible: boolean): Promise<void> {
  try {
    await updateDoc(doc(firebase.requireDb(), "skaterActivity", uid), { visible });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "unknown";
    if (code !== "not-found") logger.warn("whos_skating_visible_failed", { code });
  }
}

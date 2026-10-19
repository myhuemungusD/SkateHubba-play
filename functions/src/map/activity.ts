/**
 * "Who's skating" feed: skaterActivity/{uid} is one small doc per skater
 * saying which spot they were last at and until when they count as there.
 * Written only by the mapPresence callable (and the owner may flip
 * `visible`). It never holds a location, only a spot id and name. A skater
 * who hid their online status is written with visible: false, and the rules
 * only let other people list visible docs, so the privacy filter is on the
 * server, not in the app.
 */
import type { DiceDoc, DiceTx } from "../dice/store.js";

export function activityPath(uid: string): string {
  return `skaterActivity/${uid}`;
}

/** A stored time as ms: the Admin SDK reads back Timestamps, fakes use Dates. */
export function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/** Hidden status is the owner's onlineStatus/{uid}.hidden flag. */
export function isVisible(onlineDoc: DiceDoc): boolean {
  return onlineDoc.data?.hidden !== true;
}

/** Record that the skater is at this spot until `hereUntilMs`. */
export function writeHere(
  tx: DiceTx,
  args: {
    uid: string;
    username: string;
    spotId: string;
    spot: Record<string, unknown>;
    nowMs: number;
    hereUntilMs: number;
    visible: boolean;
  },
): void {
  const name =
    typeof args.spot.name === "string" && args.spot.name.trim() ? args.spot.name.trim().slice(0, 80) : "a spot";
  tx.set(activityPath(args.uid), {
    uid: args.uid,
    username: args.username,
    spotId: args.spotId,
    spotName: name,
    lastAt: new Date(args.nowMs),
    hereUntil: new Date(args.hereUntilMs),
    visible: args.visible,
  });
}

/**
 * The skater left this spot (or went suspect): end "skating now" but keep
 * the last-seen time for "Recently". A no-op when the doc is about another
 * spot or already ended.
 */
export function writeLeft(tx: DiceTx, uid: string, spotId: string, activity: DiceDoc, nowMs: number): void {
  const data = activity.data;
  if (!data || data.spotId !== spotId) return;
  const until = toMs(data.hereUntil);
  if (until === null || until <= nowMs) return;
  tx.set(activityPath(uid), { hereUntil: new Date(nowMs) }, true);
}

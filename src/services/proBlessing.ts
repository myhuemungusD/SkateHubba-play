/**
 * Pro blessing client. A pro badge is never earned, won or bought: the only
 * non-admin way in is a verified pro blessing you, and you accepting. Every
 * mutation goes through the `proBlessing` callable; Firestore rules reject
 * client writes to /proBlessings and to isVerifiedPro.
 *
 * firebase/functions is imported inside the call so the main bundle does not
 * pay for it while the flag is off.
 */
import { collection, getDocs, limit, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { addBreadcrumb, captureException } from "../lib/sentry";
import * as firebase from "../firebase";
import { trackEvent } from "./analytics";
import { logger } from "./logger";

export const BLESSING_REASON_MIN = 10;
export const BLESSING_REASON_MAX = 280;

export type BlessingStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

export interface Blessing {
  id: string;
  blesserUid: string;
  blesserUsername: string;
  targetUid: string;
  targetUsername: string;
  reason: string;
  status: BlessingStatus;
  createdAtMs: number;
}

const STATUSES: readonly BlessingStatus[] = ["pending", "accepted", "declined", "expired", "revoked"];

const MESSAGES: Record<string, string> = {
  unauthenticated: "Sign in first.",
  blessing_disabled: "Blessings aren't open yet.",
  email_unverified: "Verify your email first.",
  self_blessing: "You can't bless yourself.",
  bad_reason: `Say why in ${BLESSING_REASON_MIN}–${BLESSING_REASON_MAX} characters.`,
  not_a_pro: "Only verified pros can bless.",
  already_pro: "They're already pro.",
  not_eligible: "This skater can't be blessed.",
  account_too_new: "Their account is too new to be blessed yet.",
  already_offered: "Another pro already blessed them. It's waiting on their answer.",
  limit_reached: "You've used your blessings for now. Pro status stays rare.",
  not_found: "That blessing is gone.",
  not_yours: "That blessing isn't for you.",
  not_pending: "That blessing was already answered.",
  blesser_not_pro: "The pro who blessed you isn't verified anymore.",
};

export function blessingErrorMessage(err: unknown): string {
  const key = err instanceof Error ? err.message : "";
  return MESSAGES[key] ?? "That didn't work. Try again.";
}

function millis(value: unknown): number {
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === "number" ? value : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toBlessing(id: string, raw: Record<string, unknown> | undefined): Blessing | null {
  if (!raw || !STATUSES.includes(raw.status as BlessingStatus)) return null;
  if (!str(raw.blesserUid) || !str(raw.targetUid)) return null;
  return {
    id,
    blesserUid: str(raw.blesserUid),
    blesserUsername: str(raw.blesserUsername),
    targetUid: str(raw.targetUid),
    targetUsername: str(raw.targetUsername),
    reason: str(raw.reason),
    status: raw.status as BlessingStatus,
    createdAtMs: millis(raw.createdAt),
  };
}

function rows(docs: Array<{ id: string; data: () => unknown }>): Blessing[] {
  const out: Blessing[] = [];
  for (const d of docs) {
    const b = toBlessing(d.id, d.data() as Record<string, unknown>);
    if (b) out.push(b);
  }
  return out.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** Live pending blessings addressed to `uid` (the "turned pro" moment). */
export function subscribeToPendingBlessings(uid: string, onUpdate: (items: Blessing[]) => void): Unsubscribe {
  try {
    const q = query(
      collection(firebase.requireDb(), "proBlessings"),
      where("targetUid", "==", uid),
      where("status", "==", "pending"),
      limit(5),
    );
    return onSnapshot(
      q,
      (snap) => onUpdate(rows(snap.docs)),
      (err) => logger.warn("blessing_pending_failed", { error: err instanceof Error ? err.message : "unknown" }),
    );
  } catch {
    logger.warn("blessing_subscribe_failed", {});
    return () => {};
  }
}

/** The accepted blessing that made `uid` pro, or null (admin-seeded or none). */
export async function fetchAcceptedBlessing(uid: string): Promise<Blessing | null> {
  const q = query(
    collection(firebase.requireDb(), "proBlessings"),
    where("targetUid", "==", uid),
    where("status", "==", "accepted"),
    limit(1),
  );
  return rows((await getDocs(q)).docs)[0] ?? null;
}

/** Blessing lineage, newest first: who blessed `uid`, who blessed them, … */
export async function fetchLineage(uid: string, depth = 4): Promise<Blessing[]> {
  const chain: Blessing[] = [];
  const seen = new Set<string>([uid]);
  let current = uid;
  for (let i = 0; i < depth; i += 1) {
    const b = await fetchAcceptedBlessing(current);
    if (!b || seen.has(b.blesserUid)) break;
    chain.push(b);
    seen.add(b.blesserUid);
    current = b.blesserUid;
  }
  return chain;
}

/** Blessings this pro has handed out (rules let the blesser read their own). */
export async function fetchMyBlessings(uid: string): Promise<Blessing[]> {
  const q = query(collection(firebase.requireDb(), "proBlessings"), where("blesserUid", "==", uid), limit(50));
  return rows((await getDocs(q)).docs);
}

async function callBlessing(
  payload: { action: string } & Record<string, string>,
): Promise<{ blessingId: string; status: string }> {
  addBreadcrumb({ category: "pro_blessing", message: payload.action });
  try {
    await firebase.ensureAppCheck();
    const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import("firebase/functions");
    const app = firebase.default;
    if (!app) throw new Error("Firebase not initialized");
    const fns = getFunctions(app, "us-central1");
    if (firebase.isEmulatorMode) connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    const res = await httpsCallable(fns, "proBlessing")(payload);
    const data = res.data as { blessingId?: unknown; status?: unknown };
    if (typeof data?.status !== "string") throw new Error("bad response");
    return { blessingId: str(data.blessingId), status: data.status };
  } catch (err) {
    captureException(err);
    logger.warn("pro_blessing_call_failed", { action: payload.action });
    throw err;
  }
}

export async function blessSkater(targetUid: string, reason: string): Promise<string> {
  const res = await callBlessing({ action: "bless", targetUid, reason });
  trackEvent("pro_blessing_sent", { blessingId: res.blessingId });
  return res.blessingId;
}

export async function answerBlessing(blessingId: string, accept: boolean): Promise<string> {
  const res = await callBlessing({ action: accept ? "accept" : "decline", blessingId });
  trackEvent(accept ? "pro_blessing_accepted" : "pro_blessing_declined", { blessingId });
  return res.status;
}

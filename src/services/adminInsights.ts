import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import * as firebase from "../firebase";
import { recordAdminAction } from "./admin.audit";

/**
 * Admin insights (behind VITE_FEATURE_ADMIN_INSIGHTS).
 *
 * Announcements: `announcements/{id}` is admin-claim create/update only in
 * firestore.rules; any signed-in player can read active ones for the banner.
 * With push on, the announcementOnCreate function queues the pushes once.
 * Analytics: the `adminAnalytics` callable checks the admin claim server-side.
 */

export const TITLE_MAX = 80;
export const BODY_MAX = 240;
export type Audience = "all" | "testers" | "pros";
export const AUDIENCES: readonly Audience[] = ["all", "testers", "pros"];

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  push: boolean;
  active: boolean;
  pushCount: number | null;
  createdAtMs: number | null;
}

export interface AnalyticsSnapshot {
  dailyPlayers: number;
  weeklyPlayers: number;
  newPlayers7d: number;
  gamesStarted7d: number;
  gamesFinished7d: number;
  clipsPosted7d: number;
  retention: { cohort: number; returned: number };
  generatedAtMs: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
function millis(v: unknown): number | null {
  return v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function"
    ? (v as { toMillis: () => number }).toMillis()
    : null;
}

function toAnnouncement(id: string, d: Record<string, unknown>): Announcement {
  const audience = AUDIENCES.includes(d.audience as Audience) ? (d.audience as Audience) : "all";
  return {
    id,
    title: str(d.title),
    body: str(d.body),
    audience,
    push: d.push === true,
    active: d.active === true,
    pushCount: typeof d.pushCount === "number" ? d.pushCount : null,
    createdAtMs: millis(d.createdAt),
  };
}

export async function createAnnouncement(input: {
  title: string;
  body: string;
  audience: Audience;
  push: boolean;
}): Promise<string> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > TITLE_MAX) throw new Error(`Title must be 1–${TITLE_MAX} characters.`);
  if (!body || body.length > BODY_MAX) throw new Error(`Message must be 1–${BODY_MAX} characters.`);
  if (!AUDIENCES.includes(input.audience)) throw new Error("Pick who it's for.");
  const uid = firebase.requireAuth().currentUser?.uid;
  if (!uid) throw new Error("Sign in first.");
  const ref = await addDoc(collection(firebase.requireDb(), "announcements"), {
    title,
    body,
    audience: input.audience,
    push: input.push,
    active: true,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  recordAdminAction("announce", ref.id, `${input.audience}${input.push ? " +push" : ""}: ${title}`);
  return ref.id;
}

export async function endAnnouncement(id: string): Promise<void> {
  await updateDoc(doc(firebase.requireDb(), "announcements", id), { active: false });
  recordAdminAction("end_announcement", id);
}

/** Recent announcements, newest first (admin list). */
export async function listAnnouncements(): Promise<Announcement[]> {
  const snap = await getDocs(
    query(collection(firebase.requireDb(), "announcements"), orderBy("createdAt", "desc"), limit(30)),
  );
  return snap.docs.map((d) => toAnnouncement(d.id, d.data()));
}

/** Newest active announcement this player is in the audience for, or null. */
export async function getActiveAnnouncement(viewer: {
  isPro: boolean;
  isTester: boolean;
}): Promise<Announcement | null> {
  const snap = await getDocs(
    query(collection(firebase.requireDb(), "announcements"), where("active", "==", true), limit(10)),
  );
  const visible = snap.docs
    .map((d) => toAnnouncement(d.id, d.data()))
    .filter(
      (a) =>
        a.audience === "all" ||
        (a.audience === "pros" && viewer.isPro) ||
        (a.audience === "testers" && viewer.isTester),
    )
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return visible[0] ?? null;
}

const DISMISS_KEY = "skatehubba.dismissedAnnouncements";
export function dismissedAnnouncements(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function dismissAnnouncement(id: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissedAnnouncements(), id].slice(-50)));
  } catch {
    // storage unavailable: dismissal lasts for this session only
  }
}

export async function fetchAnalytics(): Promise<AnalyticsSnapshot> {
  await firebase.ensureAppCheck();
  const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import("firebase/functions");
  const app = firebase.default;
  if (!app) throw new Error("Firebase not initialized");
  const fns = getFunctions(app, "us-central1");
  if (firebase.isEmulatorMode) connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const res = await httpsCallable(fns, "adminAnalytics")({});
  const d = res.data as Partial<AnalyticsSnapshot> | null;
  if (!d || typeof d.dailyPlayers !== "number" || !d.retention) throw new Error("bad response");
  return d as AnalyticsSnapshot;
}

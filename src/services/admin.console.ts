import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";

/**
 * Admin console reads (behind VITE_FEATURE_ADMIN_CONSOLE): bans list, user
 * search and the feature-switch viewer's tester roster. Admin-claim only:
 * every read here is refused by firestore.rules for anyone else (bans list,
 * reports, config/featureTesters), so a pro or player gets nothing.
 */

const BANS_LIST_LIMIT = 100;
const USER_SEARCH_LIMIT = 20;

export interface BanRow {
  uid: string;
  username: string;
  bannedBy: string;
  bannedByUsername: string;
  reason: string;
  bannedAtMs: number | null;
}

export interface UserSearchRow {
  uid: string;
  username: string;
}

export interface UserSummary {
  uid: string;
  username: string;
  wins: number;
  losses: number;
  isVerifiedPro: boolean;
  isBanned: boolean;
  reportsAgainst: number;
  openReportsAgainst: number;
  badges: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toMs(v: unknown): number | null {
  if (v && typeof (v as { toMillis?: unknown }).toMillis === "function")
    return (v as { toMillis: () => number }).toMillis();
  return null;
}

function usernameOf(uid: string, cache: Map<string, Promise<string>>): Promise<string> {
  if (!uid) return Promise.resolve("");
  const hit = cache.get(uid);
  if (hit) return hit;
  const p = getDoc(doc(requireDb(), "users", uid)).then(
    (snap) => (snap.exists() ? str(snap.data()?.username) : ""),
    () => "",
  );
  cache.set(uid, p);
  return p;
}

/** Everyone currently banned, newest first, with who banned them and why. */
export async function listBans(): Promise<BanRow[]> {
  const snap = await getDocs(
    query(collection(requireDb(), "bans"), orderBy("bannedAt", "desc"), limit(BANS_LIST_LIMIT)),
  );
  const cache = new Map<string, Promise<string>>();
  return Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      const bannedBy = str(data.bannedBy);
      return {
        uid: d.id,
        username: await usernameOf(d.id, cache),
        bannedBy,
        bannedByUsername: await usernameOf(bannedBy, cache),
        reason: str(data.reason),
        bannedAtMs: toMs(data.bannedAt),
      };
    }),
  );
}

/** Username prefix search over the `usernames` reservations. */
export async function searchUsers(term: string): Promise<UserSearchRow[]> {
  const p = term.toLowerCase().trim().replace(/^@/, "");
  if (!p) return [];
  const snap = await getDocs(
    query(
      collection(requireDb(), "usernames"),
      where(documentId(), ">=", p),
      where(documentId(), "<", `${p}\uf8ff`),
      limit(USER_SEARCH_LIMIT),
    ),
  );
  return snap.docs.map((d) => ({ uid: str(d.data().uid), username: d.id })).filter((r) => r.uid);
}

/** One player's record, reports and badges in one place. */
export async function getUserSummary(uid: string): Promise<UserSummary | null> {
  const db = requireDb();
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const u = snap.data();
  const [reports, badges, ban] = await Promise.all([
    getDocs(query(collection(db, "reports"), where("reportedUid", "==", uid), limit(200))).catch((e) => {
      logger.warn("admin_summary_reports_failed", { error: err(e) });
      return null;
    }),
    getDocs(collection(db, "users", uid, "achievements")).catch(() => null),
    getDoc(doc(db, "bans", uid)).catch(() => null),
  ]);
  const reportDocs = reports?.docs ?? [];
  return {
    uid,
    username: str(u.username),
    wins: num(u.wins),
    losses: num(u.losses),
    isVerifiedPro: u.isVerifiedPro === true,
    isBanned: ban?.exists() === true || u.banned === true,
    reportsAgainst: reportDocs.length,
    openReportsAgainst: reportDocs.filter((r) => str(r.data().status) === "pending").length,
    badges: badges?.size ?? 0,
  };
}

/** Feature tester uids from config/featureTesters (rules: admin or listed tester). */
export async function getFeatureTesterUids(): Promise<string[]> {
  try {
    const snap = await getDoc(doc(requireDb(), "config", "featureTesters"));
    const uids = snap.exists() ? snap.data()?.uids : null;
    return Array.isArray(uids) ? uids.filter((u): u is string => typeof u === "string") : [];
  } catch (e) {
    logger.warn("admin_feature_testers_failed", { error: err(e) });
    return [];
  }
}

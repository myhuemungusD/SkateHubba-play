import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

/** Equality queries only — sorted in memory so a missing createdAt is not dropped. */
const LIST_LIMIT = 50;

export interface MyReport {
  id: string;
  reason: string;
  status: string;
  createdAt: Date | null;
  /** Clip id, game id, or "account" when the filing named neither. */
  contentRef: string;
}

export interface ModerationStatement {
  id: string;
  reportId: string;
  reason: string;
  explanation: string;
  contentRef: string;
  createdAt: Date | null;
}

/** A ban doc the signed-in user is allowed to read. `reason` may be empty. */
export interface AccountRestriction {
  reason: string;
}

export type AppealTargetKind = "statement" | "ban";

export interface MyAppeal {
  id: string;
  targetKind: AppealTargetKind;
  targetId: string;
  status: string;
  createdAt: Date | null;
}

interface DatedRow {
  createdAt: Date | null;
}

function validUid(uid: string): boolean {
  return typeof uid === "string" && uid.length > 0 && !uid.includes("/");
}

function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return null;
  const date = (toDate as () => unknown).call(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date;
}

function byNewest(a: DatedRow, b: DatedRow): number {
  const aTime = a.createdAt?.getTime() ?? Number.MIN_SAFE_INTEGER;
  const bTime = b.createdAt?.getTime() ?? Number.MIN_SAFE_INTEGER;
  return bTime - aTime;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function contentRefFrom(data: Record<string, unknown>): string {
  if (typeof data.clipId === "string" && data.clipId.length > 0) return data.clipId;
  if (typeof data.gameId === "string" && data.gameId.length > 0) return data.gameId;
  return "account";
}

/**
 * Reports this user filed. The reported user cannot read these; the reporter can.
 * Sorted newest first in memory.
 */
export async function listMyReports(uid: string): Promise<MyReport[]> {
  if (!validUid(uid)) return [];
  const snap = await getDocs(
    query(collection(requireDb(), "reports"), where("reporterUid", "==", uid), limit(LIST_LIMIT)),
  );
  const rows: MyReport[] = [];
  for (const docSnap of snap.docs) {
    try {
      const data = asRecord(docSnap.data());
      if (!data || data.reporterUid !== uid) continue;
      if (typeof data.reason !== "string" || typeof data.status !== "string") {
        logger.warn("malformed_my_report", { docId: docSnap.id });
        continue;
      }
      rows.push({
        id: docSnap.id,
        reason: data.reason,
        status: data.status,
        createdAt: toDateOrNull(data.createdAt),
        contentRef: contentRefFrom(data),
      });
    } catch (err) {
      logger.warn("my_report_parse_failed", { docId: docSnap.id, error: parseFirebaseError(err) });
    }
  }
  return rows.sort(byNewest);
}

/** Statements of reasons addressed to this user (content that was restricted). */
export async function listMyStatements(uid: string): Promise<ModerationStatement[]> {
  if (!validUid(uid)) return [];
  const snap = await getDocs(
    query(collection(requireDb(), "moderationStatements"), where("subjectUid", "==", uid), limit(LIST_LIMIT)),
  );
  const rows: ModerationStatement[] = [];
  for (const docSnap of snap.docs) {
    try {
      const data = asRecord(docSnap.data());
      if (!data || data.subjectUid !== uid) continue;
      if (
        data.action !== "content_restricted" ||
        typeof data.explanation !== "string" ||
        typeof data.reason !== "string" ||
        typeof data.reportId !== "string" ||
        typeof data.contentRef !== "string"
      ) {
        logger.warn("malformed_moderation_statement", { docId: docSnap.id });
        continue;
      }
      rows.push({
        id: docSnap.id,
        reportId: data.reportId,
        reason: data.reason,
        explanation: data.explanation,
        contentRef: data.contentRef,
        createdAt: toDateOrNull(data.createdAt),
      });
    } catch (err) {
      logger.warn("moderation_statement_parse_failed", { docId: docSnap.id, error: parseFirebaseError(err) });
    }
  }
  return rows.sort(byNewest);
}

/**
 * The caller's own ban, or null when they are not banned.
 * `list` on bans is admin-only; this is a single-document get.
 */
export async function getMyBan(uid: string): Promise<AccountRestriction | null> {
  if (!validUid(uid)) return null;
  const snap = await getDoc(doc(requireDb(), "bans", uid));
  if (!snap.exists()) return null;
  const data = asRecord(snap.data());
  const reason = data && typeof data.reason === "string" ? data.reason : "";
  return { reason };
}

/** Appeals this user has filed. */
export async function listMyAppeals(uid: string): Promise<MyAppeal[]> {
  if (!validUid(uid)) return [];
  const snap = await getDocs(
    query(collection(requireDb(), "appeals"), where("appellantUid", "==", uid), limit(LIST_LIMIT)),
  );
  const rows: MyAppeal[] = [];
  for (const docSnap of snap.docs) {
    try {
      const data = asRecord(docSnap.data());
      if (!data || data.appellantUid !== uid) continue;
      if (
        (data.targetKind !== "statement" && data.targetKind !== "ban") ||
        typeof data.targetId !== "string" ||
        typeof data.status !== "string"
      ) {
        logger.warn("malformed_appeal", { docId: docSnap.id });
        continue;
      }
      rows.push({
        id: docSnap.id,
        targetKind: data.targetKind,
        targetId: data.targetId,
        status: data.status,
        createdAt: toDateOrNull(data.createdAt),
      });
    } catch (err) {
      logger.warn("appeal_parse_failed", { docId: docSnap.id, error: parseFirebaseError(err) });
    }
  }
  return rows.sort(byNewest);
}

/**
 * File one appeal against a statement of reasons or the caller's own ban.
 * The doc id is deterministic, so a second filing is an update the rules reject.
 */
export async function submitAppeal(
  uid: string,
  targetKind: AppealTargetKind,
  targetId: string,
  explanation: string,
): Promise<void> {
  if (!validUid(uid)) throw new Error("Invalid appeal.");
  if (targetKind !== "statement" && targetKind !== "ban") throw new Error("Invalid appeal.");
  if (typeof targetId !== "string" || targetId.length === 0 || targetId.includes("/")) {
    throw new Error("Invalid appeal.");
  }
  const trimmed = typeof explanation === "string" ? explanation.trim() : "";
  if (trimmed.length < 1) throw new Error("Explain why this should be reviewed.");
  if (trimmed.length > 1000) throw new Error("Appeals must be 1,000 characters or fewer.");

  try {
    await setDoc(doc(requireDb(), "appeals", `${targetKind}_${targetId}`), {
      appellantUid: uid,
      targetKind,
      targetId,
      explanation: trimmed,
      status: "pending",
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    logger.warn("appeal_submit_failed", { uid, targetKind, targetId, error: parseFirebaseError(err) });
    throw new Error("Failed to submit appeal. Please try again.");
  }
}

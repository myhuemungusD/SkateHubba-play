/**
 * Public-clip moderation reads and the admin keep/remove call.
 *
 * Firestore reads stay in this module. The keep/remove write goes through
 * the `decideClipModeration` callable because clients cannot change
 * `moderation` themselves.
 */

import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import app, { isEmulatorMode, requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";

const REVIEW_LIMIT = 30;
const OWN_LIMIT = 40;
const MAX_REASON = 200;

/** Same screen SafetyReportsSection renders under Settings. */
const CLIP_APPEAL_PATH = "/settings#safety-reports";

export interface ReviewClip {
  id: string;
  playerUid: string;
  playerUsername: string;
  trickName: string;
  videoUrl: string;
  explicitLikelihood: string;
  skateDetected: boolean;
  skateLabels: string[];
  reportReasons: string[];
  grounds: string;
}

export interface OwnClipModerationRow {
  id: string;
  trickName: string;
  moderation: "pending" | "review" | "rejected" | "removed";
  statement: string;
  appealPath: string | null;
}

export type ClipDecision = "approved" | "removed";

let emulatorConnected = false;

/** Test seam so the emulator connect branch can run twice. */
export function _resetClipModerationEmulator(): void {
  emulatorConnected = false;
}

function moderationFunctions(): ReturnType<typeof getFunctions> {
  if (!app) throw new Error("The app is not configured.");
  const fns = getFunctions(app, "us-central1");
  if (isEmulatorMode && !emulatorConnected) {
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    emulatorConnected = true;
  }
  return fns;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function noticeOf(data: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(data.moderationNotice);
}

export function parseReviewClip(id: string, raw: unknown): ReviewClip | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (data.moderation !== "review") return null;
  if (typeof data.videoUrl !== "string" || data.videoUrl.length === 0) return null;
  if (typeof data.playerUid !== "string" || typeof data.trickName !== "string") return null;
  const scores = asRecord(data.moderationScores);
  const notice = noticeOf(data);
  return {
    id,
    playerUid: data.playerUid,
    playerUsername: typeof data.playerUsername === "string" ? data.playerUsername : "",
    trickName: data.trickName,
    videoUrl: data.videoUrl,
    explicitLikelihood: typeof scores?.explicitLikelihood === "string" ? scores.explicitLikelihood : "UNKNOWN",
    skateDetected: scores?.skateDetected === true,
    skateLabels: stringList(scores?.skateLabels),
    reportReasons: stringList(data.reportReasons),
    grounds: typeof notice?.grounds === "string" ? notice.grounds : "",
  };
}

const OWN_STATEMENTS: Record<OwnClipModerationRow["moderation"], string> = {
  pending: "Checking…",
  review: "In review",
  rejected: "This clip was rejected.",
  removed: "This clip was removed.",
};

function ownStatement(moderation: OwnClipModerationRow["moderation"], notice: Record<string, unknown> | null): string {
  if (typeof notice?.statement === "string" && notice.statement.length > 0) return notice.statement;
  return OWN_STATEMENTS[moderation];
}

export function parseOwnClip(id: string, raw: unknown): OwnClipModerationRow | null {
  const data = asRecord(raw);
  if (!data || data.source !== "user") return null;
  const moderation = data.moderation;
  if (moderation !== "pending" && moderation !== "review" && moderation !== "rejected" && moderation !== "removed") {
    return null;
  }
  const notice = noticeOf(data);
  const appealPath =
    moderation === "review" || moderation === "rejected" || moderation === "removed"
      ? typeof notice?.appealPath === "string" && notice.appealPath.length > 0
        ? notice.appealPath
        : CLIP_APPEAL_PATH
      : null;
  return {
    id,
    trickName: typeof data.trickName === "string" ? data.trickName : "Clip",
    moderation,
    statement: ownStatement(moderation, notice),
    appealPath,
  };
}

function requireClipId(clipId: string): void {
  if (typeof clipId !== "string" || clipId.length === 0 || clipId.length > 128 || clipId.includes("/")) {
    throw new Error("Invalid clip.");
  }
}

/** Clips waiting on a person. Admins can read every clip. */
export async function fetchClipsInReview(): Promise<ReviewClip[]> {
  try {
    const snap = await getDocs(
      query(collection(requireDb(), "clips"), where("moderation", "==", "review"), limit(REVIEW_LIMIT)),
    );
    const clips: ReviewClip[] = [];
    for (const row of snap.docs) {
      const parsed = parseReviewClip(row.id, row.data());
      if (parsed) clips.push(parsed);
    }
    return clips;
  } catch (err) {
    logger.warn("clip_review_queue_failed", { error: parseFirebaseError(err) });
    throw new Error("Couldn't load clips in review.");
  }
}

const OWN_MODERATION = ["pending", "review", "rejected", "removed"] as const;

/** The signed-in skater's clips that are not in the public feed yet. */
export async function fetchOwnClipModeration(uid: string): Promise<OwnClipModerationRow[]> {
  requireClipId(uid);
  try {
    // source + moderation keep game clips (and live posts) out of the page.
    // Ordering by createdAt makes the limit the newest unfinished clips.
    const snap = await getDocs(
      query(
        collection(requireDb(), "clips"),
        where("playerUid", "==", uid),
        where("source", "==", "user"),
        where("moderation", "in", [...OWN_MODERATION]),
        orderBy("createdAt", "desc"),
        limit(OWN_LIMIT),
      ),
    );
    const rows: OwnClipModerationRow[] = [];
    for (const row of snap.docs) {
      const parsed = parseOwnClip(row.id, row.data());
      if (parsed) rows.push(parsed);
    }
    return rows;
  } catch (err) {
    logger.warn("own_clip_moderation_failed", { uid, error: parseFirebaseError(err) });
    throw new Error("Couldn't load your clips.");
  }
}

export async function decideClipModeration(clipId: string, decision: string, reason: string): Promise<void> {
  requireClipId(clipId);
  if (decision !== "approved" && decision !== "removed") {
    throw new Error("Choose keep or remove.");
  }
  const trimmed = reason.trim().slice(0, MAX_REASON);
  if (decision === "removed" && trimmed.length === 0) {
    throw new Error("A reason is required to remove a clip.");
  }
  try {
    const callable = httpsCallable(moderationFunctions(), "decideClipModeration");
    await callable({ clipId, decision, reason: trimmed });
  } catch (err) {
    logger.warn("clip_moderation_decide_failed", { clipId, decision, error: parseFirebaseError(err) });
    if (err instanceof Error && err.message.length > 0 && !err.message.startsWith("Firebase")) {
      throw new Error(err.message);
    }
    throw new Error("Couldn't update that clip.");
  }
}

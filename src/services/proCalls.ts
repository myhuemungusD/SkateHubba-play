import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { submitProReview } from "./wtt";
import { logger } from "./logger";

/**
 * Pro review queue + gold clip authoring (behind VITE_FEATURE_PRO_CALLS).
 * Verified-pro scoped by firestore.rules; no admin power. The
 * proReviewOnCreate / proGoldOnCreate triggers turn the first pro call on a
 * clip into its wttGold label.
 */

export const PRO_QUEUE_LIMIT = 20;

export interface ProCallItem {
  clipId: string;
  options: string[];
  videoUrl: string | null;
  voteCount: number;
}

async function withVideo(clipId: string, raw: Record<string, unknown>): Promise<ProCallItem> {
  let videoUrl: string | null = null;
  try {
    const clip = await getDoc(doc(requireDb(), "clips", clipId));
    const v = clip.exists() ? clip.data()?.videoUrl : null;
    videoUrl = typeof v === "string" ? v : null;
  } catch {
    videoUrl = null;
  }
  return {
    clipId,
    options: Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === "string") : [],
    videoUrl,
    voteCount: typeof raw.voteCount === "number" ? raw.voteCount : 0,
  };
}

async function itemsWithStatus(status: "pro_queue" | "open"): Promise<ProCallItem[]> {
  try {
    const snap = await getDocs(
      query(collection(requireDb(), "wttItems"), where("status", "==", status), limit(PRO_QUEUE_LIMIT)),
    );
    return await Promise.all(snap.docs.map((d) => withVideo(d.id, d.data())));
  } catch (err) {
    logger.warn("pro_calls_load_failed", { status, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Split What's That Trick votes waiting on a pro's call. */
export function fetchProQueue(): Promise<ProCallItem[]> {
  return itemsWithStatus("pro_queue");
}

/** Open clips a pro can mark with the known-correct trick. */
export function fetchGoldCandidates(): Promise<ProCallItem[]> {
  return itemsWithStatus("open");
}

/** Settle a split vote. One call per pro per clip (rules). */
export function submitProCall(clipId: string, uid: string, answerTrickId: string): Promise<void> {
  return submitProReview(clipId, uid, answerTrickId);
}

/** Mark a clip's known-correct trick. First pro per clip wins (rules). */
export async function submitGoldClip(clipId: string, uid: string, answerTrickId: string): Promise<void> {
  await setDoc(doc(requireDb(), "proGold", clipId), { clipId, uid, answerTrickId, createdAt: serverTimestamp() });
}

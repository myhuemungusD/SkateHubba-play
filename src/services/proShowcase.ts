import { collection, getDocs, query } from "firebase/firestore";
import { requireDb } from "../firebase";
import type { Spot } from "../types/spot";
import { fetchPinnedClips, getProfileCustom, type PinnableClip } from "./profileCustom";
import { getSpot, listSpotsByCreator } from "./spots";
import { logger } from "./logger";
import { isUserPostedClip } from "./clipVisibility";
import { proSpotsConstraints } from "./proSpotsQuery";

/**
 * Pro profile Clip Reel + Pro Spots (behind VITE_FEATURE_PRO_SHOWCASE).
 *
 * Read-only: no new data or rules. The reel is the pro's own pinned clips
 * from profileCustom (picked by them, max 3). Pro Spots are the spots the pro
 * added to the map (their recommendations) plus every spot they have tagged
 * a clip at, each with those clips.
 */

/** Max spots shown on a pro profile. */
export const PRO_SPOTS_LIMIT = 8;

export interface ProSpot {
  spot: Spot;
  /** The pro added this spot to the map. */
  recommended: boolean;
  clips: PinnableClip[];
}

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The pro's pinned clips in pin order; [] when none are pinned or on error. */
export async function fetchProClipReel(uid: string): Promise<PinnableClip[]> {
  try {
    const custom = await getProfileCustom(uid);
    if (!custom || custom.pinnedClipIds.length === 0) return [];
    return await fetchPinnedClips(uid, custom.pinnedClipIds);
  } catch (e) {
    logger.warn("pro_clip_reel_failed", { error: err(e) });
    return [];
  }
}

/** Spots the pro skates or recommends, most clips first, recommended ties first. */
export async function fetchProSpots(uid: string): Promise<ProSpot[]> {
  try {
    const [clipSnap, created] = await Promise.all([
      // Active user posts only; see proSpotsQuery.ts for why each filter is
      // there and what an orderBy would need (a composite index + deploy).
      getDocs(query(collection(requireDb(), "clips"), ...proSpotsConstraints(uid))),
      listSpotsByCreator(uid).catch(() => [] as Spot[]),
    ]);
    const bySpot = new Map<string, PinnableClip[]>();
    for (const d of clipSnap.docs) {
      const raw = d.data() as Record<string, unknown>;
      // A profile shows user posts only; game clips stay in the game screens.
      if (!isUserPostedClip(raw)) continue;
      if (typeof raw.spotId !== "string" || !raw.spotId) continue;
      if (typeof raw.videoUrl !== "string" || typeof raw.trickName !== "string") continue;
      const list = bySpot.get(raw.spotId) ?? [];
      list.push({
        id: d.id,
        trickName: raw.trickName,
        videoUrl: raw.videoUrl,
        thumbnailUrl: typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : null,
      });
      bySpot.set(raw.spotId, list);
    }
    const out = new Map<string, ProSpot>();
    for (const spot of created) out.set(spot.id, { spot, recommended: true, clips: bySpot.get(spot.id) ?? [] });
    const missing = [...bySpot.keys()].filter((id) => !out.has(id));
    const fetched = await Promise.all(missing.map((id) => getSpot(id).catch(() => null)));
    fetched.forEach((spot) => {
      if (spot && spot.isActive)
        out.set(spot.id, { spot, recommended: false, clips: bySpot.get(spot.id) as PinnableClip[] });
    });
    return [...out.values()]
      .sort((a, b) => b.clips.length - a.clips.length || Number(b.recommended) - Number(a.recommended))
      .slice(0, PRO_SPOTS_LIMIT);
  } catch (e) {
    logger.warn("pro_spots_failed", { error: err(e) });
    return [];
  }
}

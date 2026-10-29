import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { getUidByUsername } from "./users";
import { logger } from "./logger";
import { isUserPostedClip } from "./clipVisibility";

/**
 * Pro challenges, pro props and pro-featured clips (behind
 * VITE_FEATURE_PRO_COMMUNITY). firestore.rules scope every create to a
 * verified pro (entries: any player, own clip). Nothing here is an admin
 * power, and props/shout-outs are never pro status: only a blessing is.
 */

export const LIST_LIMIT = 30;
export const MAX_FEATURED_PER_PRO = 3;
export const PROP_STICKERS = ["fire", "steez", "gnarly", "clean", "respect"] as const;
export type PropSticker = (typeof PROP_STICKERS)[number];

export interface ProChallenge {
  id: string;
  proUid: string;
  proUsername: string;
  trickName: string;
  description: string;
}
export interface ChallengeEntry {
  id: string;
  challengeId: string;
  uid: string;
  username: string;
  clipId: string;
  featured: boolean;
}
export interface ProProp {
  id: string;
  fromUid: string;
  fromUsername: string;
  toUid: string;
  toUsername: string;
  sticker: string;
  note: string;
}
export interface FeaturedClip {
  clipId: string;
  proUid: string;
  proUsername: string;
  videoUrl: string | null;
  trickName: string;
  /**
   * The featured clip is a user post. Pro Picks (a feed surface) shows only
   * these; the pro's own Featured tool still lists the rest so they can unpin.
   */
  userClip: boolean;
}

const s = (v: unknown) => (typeof v === "string" ? v : "");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ── Challenges ── */

export async function createChallenge(
  pro: { uid: string; username: string },
  trickName: string,
  description: string,
): Promise<string> {
  const trick = trickName.trim();
  if (!trick || trick.length > 60) throw new Error("Name the trick (60 characters max).");
  const ref = await addDoc(collection(requireDb(), "proChallenges"), {
    proUid: pro.uid,
    proUsername: pro.username,
    trickName: trick,
    description: description.trim().slice(0, 280),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listChallenges(): Promise<ProChallenge[]> {
  try {
    const snap = await getDocs(
      query(collection(requireDb(), "proChallenges"), orderBy("createdAt", "desc"), limit(LIST_LIMIT)),
    );
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        proUid: s(x.proUid),
        proUsername: s(x.proUsername),
        trickName: s(x.trickName),
        description: s(x.description),
      };
    });
  } catch (e) {
    logger.warn("pro_challenges_load_failed", { error: errMsg(e) });
    return [];
  }
}

export async function listEntries(challengeId: string): Promise<ChallengeEntry[]> {
  try {
    const snap = await getDocs(
      query(collection(requireDb(), "proChallengeEntries"), where("challengeId", "==", challengeId), limit(LIST_LIMIT)),
    );
    return snap.docs
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          challengeId: s(x.challengeId),
          uid: s(x.uid),
          username: s(x.username),
          clipId: s(x.clipId),
          featured: x.featured === true,
        };
      })
      .sort((a, b) => Number(b.featured) - Number(a.featured));
  } catch (e) {
    logger.warn("pro_challenge_entries_failed", { error: errMsg(e) });
    return [];
  }
}

/** A player answers a challenge with one of their own clips. One entry per player. */
export async function enterChallenge(
  challengeId: string,
  player: { uid: string; username: string },
  clipId: string,
): Promise<void> {
  await setDoc(doc(requireDb(), "proChallengeEntries", `${challengeId}_${player.uid}`), {
    challengeId,
    uid: player.uid,
    username: player.username,
    clipId,
    featured: false,
    createdAt: serverTimestamp(),
  });
}

/** The challenge's pro features (or un-features) a make: a shout-out, never a pro badge. */
export async function setEntryFeatured(entryId: string, featured: boolean): Promise<void> {
  await updateDoc(doc(requireDb(), "proChallengeEntries", entryId), { featured });
}

/* ── Props ── */

export async function giveProps(
  from: { uid: string; username: string },
  toUsername: string,
  sticker: PropSticker,
  note: string,
): Promise<void> {
  const name = toUsername.trim().replace(/^@/, "").toLowerCase();
  if (!PROP_STICKERS.includes(sticker)) throw new Error("Pick a sticker.");
  const toUid = name ? await getUidByUsername(name) : null;
  if (!toUid) throw new Error("No skater with that username.");
  if (toUid === from.uid) throw new Error("Props go to other skaters.");
  await addDoc(collection(requireDb(), "proProps"), {
    fromUid: from.uid,
    fromUsername: from.username,
    toUid,
    toUsername: name,
    sticker,
    note: note.trim().slice(0, 140),
    createdAt: serverTimestamp(),
  });
}

export async function listPropsFor(uid: string): Promise<ProProp[]> {
  try {
    const snap = await getDocs(
      query(collection(requireDb(), "proProps"), where("toUid", "==", uid), limit(LIST_LIMIT)),
    );
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        fromUid: s(x.fromUid),
        fromUsername: s(x.fromUsername),
        toUid: s(x.toUid),
        toUsername: s(x.toUsername),
        sticker: s(x.sticker),
        note: s(x.note),
      };
    });
  } catch (e) {
    logger.warn("pro_props_load_failed", { error: errMsg(e) });
    return [];
  }
}

/* ── Featured clips ── */

async function clipInfo(clipId: string): Promise<{ videoUrl: string | null; trickName: string; userClip: boolean }> {
  try {
    const snap = await getDoc(doc(requireDb(), "clips", clipId));
    const x = snap.exists() ? snap.data() : undefined;
    return {
      videoUrl: typeof x?.videoUrl === "string" ? x.videoUrl : null,
      trickName: s(x?.trickName),
      userClip: isUserPostedClip(x),
    };
  } catch {
    return { videoUrl: null, trickName: "", userClip: false };
  }
}

export async function listFeaturedClips(): Promise<FeaturedClip[]> {
  try {
    const snap = await getDocs(
      query(collection(requireDb(), "proFeatured"), orderBy("createdAt", "desc"), limit(LIST_LIMIT)),
    );
    return await Promise.all(
      snap.docs.map(async (d) => {
        const x = d.data();
        return { clipId: d.id, proUid: s(x.proUid), proUsername: s(x.proUsername), ...(await clipInfo(d.id)) };
      }),
    );
  } catch (e) {
    logger.warn("pro_featured_load_failed", { error: errMsg(e) });
    return [];
  }
}

/** Pin a clip to the top of the feed. Each pro keeps at most MAX_FEATURED_PER_PRO. */
export async function featureClip(pro: { uid: string; username: string }, clipId: string): Promise<void> {
  const id = clipId.trim();
  if (!id) throw new Error("Paste a clip id.");
  const mine = await getDocs(
    query(collection(requireDb(), "proFeatured"), where("proUid", "==", pro.uid), limit(MAX_FEATURED_PER_PRO + 1)),
  );
  if (mine.size >= MAX_FEATURED_PER_PRO)
    throw new Error(`You can feature up to ${MAX_FEATURED_PER_PRO} clips. Unpin one first.`);
  await setDoc(doc(requireDb(), "proFeatured", id), {
    clipId: id,
    proUid: pro.uid,
    proUsername: pro.username,
    createdAt: serverTimestamp(),
  });
}

export async function unfeatureClip(clipId: string): Promise<void> {
  await deleteDoc(doc(requireDb(), "proFeatured", clipId));
}

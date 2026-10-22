import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { ensureStorage, requireAuth, requireDb, requireStorage } from "../firebase";
import { creditForTemplate, STUDIO_SLOTS, type StudioSlot } from "../lib/closetStudio/templates";
import { isAvatarSafe } from "./avatarModeration";
import { logger } from "./logger";

/**
 * Closet Studio saves (behind VITE_FEATURE_CLOSET_STUDIO).
 *
 *   users/{uid}/closetDesigns/{designId}   metadata (firestore.rules: closetDesignValid)
 *   closetDesigns/{uid}/{designId}.webp    flattened picture (storage.rules)
 *
 * Rules are the boundary: owner-only writes, a fixed key set, at most
 * MAX_DESIGNS slots (designId d0..d23), a 1 MB picture cap, the image URL
 * pinned to the owner's own object, and the Mike White credit line required
 * whenever templateId names one of his designs. A design only becomes public
 * (`shared: true`) after the same on-device image filter as avatars passes
 * (`moderation: "passed"`); rules refuse shared without it.
 */

export const MAX_DESIGNS = 24;
export const MAX_DESIGN_BYTES = 1024 * 1024;
export const MIN_DESIGN_BYTES = 100;
export const MAX_NAME = 40;
const NSFW_WARN_THRESHOLD = 0.5;

export type DesignError = "unauthenticated" | "too_large" | "too_small" | "rejected" | "full" | "bad_name" | "bad_id";

export class ClosetDesignError extends Error {
  readonly code: DesignError;
  constructor(code: DesignError) {
    super(`closet_design_${code}`);
    this.name = "ClosetDesignError";
    this.code = code;
  }
}

export interface ClosetDesign {
  id: string;
  name: string;
  slot: StudioSlot;
  templateId: string;
  credit: string;
  imageUrl: string;
  layerCount: number;
  shared: boolean;
}

export interface SaveDesignInput {
  id: string;
  name: string;
  slot: StudioSlot;
  templateId: string;
  layerCount: number;
  image: Blob;
  share: boolean;
}

const ID_RE = /^d([0-9]|1[0-9]|2[0-3])$/;

export function isDesignId(id: string): boolean {
  return ID_RE.test(id);
}

/** First unused slot id, or null when every slot is taken. */
export function nextDesignId(existing: readonly string[]): string | null {
  for (let i = 0; i < MAX_DESIGNS; i++) if (!existing.includes(`d${i}`)) return `d${i}`;
  return null;
}

function objectPath(uid: string, id: string): string {
  return `closetDesigns/${uid}/${id}.webp`;
}

function requireOwner(uid: string): void {
  const user = requireAuth().currentUser;
  if (!user || user.uid !== uid) throw new ClosetDesignError("unauthenticated");
}

function toDesign(id: string, raw: Record<string, unknown>): ClosetDesign | null {
  const slot = raw.slot as StudioSlot;
  if (typeof raw.imageUrl !== "string" || !STUDIO_SLOTS.includes(slot)) return null;
  const templateId = typeof raw.templateId === "string" ? raw.templateId : "";
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "Untitled",
    slot,
    templateId,
    credit: creditForTemplate(templateId),
    imageUrl: raw.imageUrl,
    layerCount: typeof raw.layerCount === "number" ? raw.layerCount : 1,
    shared: raw.shared === true,
  };
}

export async function listMyDesigns(uid: string): Promise<ClosetDesign[]> {
  const snap = await getDocs(collection(requireDb(), "users", uid, "closetDesigns"));
  return snap.docs
    .map((d) => toDesign(d.id, d.data() as Record<string, unknown>))
    .filter((d): d is ClosetDesign => d !== null)
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** Upload the picture, then write the metadata. Sharing runs the image filter first. */
export async function saveDesign(uid: string, input: SaveDesignInput): Promise<ClosetDesign> {
  requireOwner(uid);
  if (!isDesignId(input.id)) throw new ClosetDesignError("bad_id");
  const name = input.name.trim().slice(0, MAX_NAME);
  if (!name) throw new ClosetDesignError("bad_name");
  if (input.image.size > MAX_DESIGN_BYTES) throw new ClosetDesignError("too_large");
  if (input.image.size < MIN_DESIGN_BYTES) throw new ClosetDesignError("too_small");
  if (input.share) {
    const safety = await isAvatarSafe(input.image);
    if (!safety.ok || safety.score >= NSFW_WARN_THRESHOLD) throw new ClosetDesignError("rejected");
  }

  await ensureStorage();
  await deleteDesignObject(uid, input.id);
  const result = await uploadBytes(storageRef(requireStorage(), objectPath(uid, input.id)), input.image, {
    contentType: "image/webp",
    customMetadata: { uploaderUid: uid },
  });
  const imageUrl = await getDownloadURL(result.ref);
  const credit = creditForTemplate(input.templateId);
  const layerCount = Math.max(1, Math.min(8, Math.round(input.layerCount)));
  await setDoc(doc(requireDb(), "users", uid, "closetDesigns", input.id), {
    name,
    slot: input.slot,
    templateId: input.templateId,
    credit,
    imageUrl,
    layerCount,
    shared: input.share,
    moderation: input.share ? "passed" : "pending",
    updatedAt: serverTimestamp(),
  });
  return {
    id: input.id,
    name,
    slot: input.slot,
    templateId: input.templateId,
    credit,
    imageUrl,
    layerCount,
    shared: input.share,
  };
}

/** Best-effort delete of a design picture. True iff something was removed. */
export async function deleteDesignObject(uid: string, id: string): Promise<boolean> {
  await ensureStorage();
  try {
    await deleteObject(storageRef(requireStorage(), objectPath(uid, id)));
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code !== "storage/object-not-found") {
      logger.warn("closet_design_delete_failed", { uid, id, error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  }
}

export async function deleteDesign(uid: string, id: string): Promise<void> {
  requireOwner(uid);
  await deleteDesignObject(uid, id);
  await deleteDoc(doc(requireDb(), "users", uid, "closetDesigns", id));
}

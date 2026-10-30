import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import { MUSIC_TRACKS } from "../lib/clipEditor/musicLibrary";
import { logger } from "./logger";
import { isUserPostedClip } from "./clipVisibility";

/**
 * Customizable profiles (behind VITE_FEATURE_PROFILE_CUSTOM).
 *
 * One doc per player at `users/{uid}/profileCustom/main`. Everything here is
 * mirrored by firestore.rules, which is the real boundary: owner-only writes,
 * fixed key set, length/size caps and the same link allowlist as
 * {@link isAllowedLink}. The client sanitizes first so a bad value never
 * costs a round trip and an old/foreign doc never breaks a profile render.
 *
 * Images: the only picture on a custom profile is the banner, which keeps
 * going through services/banners.ts (avatar NSFW filter). Crop/position is
 * stored here as numbers only.
 */

export const SECTION_IDS = ["clips", "stats", "closet", "crew", "spots"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const LIMITS = {
  bio: 280,
  links: 5,
  linkLabel: 30,
  url: 200,
  sponsors: 5,
  sponsorName: 40,
  tricks: 5,
  trick: 40,
  pinnedClips: 3,
  clipId: 128,
} as const;

interface ProfileLink {
  label: string;
  url: string;
}
interface ProfileSponsor {
  name: string;
  url: string;
}

export interface ProfileCustom {
  accent: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  bannerPosX: number;
  bannerPosY: number;
  bannerZoom: number;
  sections: SectionId[];
  pinnedClipIds: string[];
  showcaseSignature: boolean;
  bio: string;
  links: ProfileLink[];
  sponsors: ProfileSponsor[];
  favoriteTricks: string[];
  themeSongId: string;
}

export const DEFAULT_PROFILE_CUSTOM: ProfileCustom = {
  accent: "#FF6B00",
  gradientFrom: "#1A1A1A",
  gradientTo: "#0A0A0A",
  gradientAngle: 180,
  bannerPosX: 50,
  bannerPosY: 50,
  bannerZoom: 100,
  sections: [...SECTION_IDS],
  pinnedClipIds: [],
  showcaseSignature: true,
  bio: "",
  links: [],
  sponsors: [],
  favoriteTricks: [],
  themeSongId: "",
};

/** Hosts a profile link may point at. Mirrors LINK_RE in firestore.rules. */
export const LINK_HOSTS = [
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
  "twitch.tv",
  "spotify.com",
  "soundcloud.com",
  "linktr.ee",
  "threads.net",
  "facebook.com",
  "vimeo.com",
  "myshopify.com",
  "bigcartel.com",
  "etsy.com",
  "depop.com",
  "skatehubba.com",
] as const;

/** Escape every RegExp metacharacter (backslash included) so a host is matched literally. */
export const escapeRegExp = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
/** Same pattern string as firestore.rules (RE2 full match). */
export const LINK_PATTERN = `^https://([a-z0-9-]+\\.)?(${LINK_HOSTS.map(escapeRegExp).join("|")})(/[^\\s]*)?$`;
const LINK_RE = new RegExp(LINK_PATTERN);
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isAllowedLink(url: string): boolean {
  return url.length <= LIMITS.url && LINK_RE.test(url);
}

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Valid complete section order: every id exactly once; else the default. */
export function normalizeSections(v: unknown): SectionId[] {
  const arr = list(v);
  const ok =
    arr.length === SECTION_IDS.length &&
    SECTION_IDS.every((id) => arr.includes(id)) &&
    new Set(arr).size === arr.length;
  return ok ? (arr as SectionId[]) : [...SECTION_IDS];
}

/**
 * Coerce anything (a Firestore doc, a form state) into a valid ProfileCustom.
 * Bad entries are dropped, not repaired, so what saves is what rules accept.
 */
export function sanitizeProfileCustom(raw: unknown): ProfileCustom {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PROFILE_CUSTOM;
  const links = list(r.links)
    .map((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      return { label: str(o.label, LIMITS.linkLabel), url: str(o.url, LIMITS.url + 1) };
    })
    .filter((l) => l.label.length > 0 && isAllowedLink(l.url))
    .slice(0, LIMITS.links);
  const sponsors = list(r.sponsors)
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { name: str(o.name, LIMITS.sponsorName), url: str(o.url, LIMITS.url + 1) };
    })
    .filter((s) => s.name.length > 0 && (s.url === "" || isAllowedLink(s.url)))
    .slice(0, LIMITS.sponsors);
  const favoriteTricks = list(r.favoriteTricks)
    .map((t) => str(t, LIMITS.trick))
    .filter((t) => t.length > 0)
    .slice(0, LIMITS.tricks);
  const pinnedClipIds = [
    ...new Set(
      list(r.pinnedClipIds).filter(
        (c): c is string => typeof c === "string" && c.length > 0 && c.length <= LIMITS.clipId,
      ),
    ),
  ].slice(0, LIMITS.pinnedClips);
  const song = typeof r.themeSongId === "string" ? r.themeSongId : "";
  return {
    accent: isHexColor(r.accent) ? r.accent : d.accent,
    gradientFrom: isHexColor(r.gradientFrom) ? r.gradientFrom : d.gradientFrom,
    gradientTo: isHexColor(r.gradientTo) ? r.gradientTo : d.gradientTo,
    gradientAngle: intIn(r.gradientAngle, 0, 359, d.gradientAngle),
    bannerPosX: intIn(r.bannerPosX, 0, 100, d.bannerPosX),
    bannerPosY: intIn(r.bannerPosY, 0, 100, d.bannerPosY),
    bannerZoom: intIn(r.bannerZoom, 100, 200, d.bannerZoom),
    sections: normalizeSections(r.sections),
    pinnedClipIds,
    showcaseSignature: typeof r.showcaseSignature === "boolean" ? r.showcaseSignature : d.showcaseSignature,
    bio: str(r.bio, LIMITS.bio),
    links,
    sponsors,
    favoriteTricks,
    themeSongId: MUSIC_TRACKS.some((t) => t.id === song) ? song : "",
  };
}

/** Move a section one step up (-1) or down (+1). Out-of-range moves are no-ops. */
export function moveSection(order: SectionId[], id: SectionId, dir: -1 | 1): SectionId[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Add or remove a pinned clip, keeping the 3-clip cap. */
export function togglePinnedClip(ids: string[], clipId: string): string[] {
  if (ids.includes(clipId)) return ids.filter((x) => x !== clipId);
  if (ids.length >= LIMITS.pinnedClips) return ids;
  return [...ids, clipId];
}

/** CSS background for the profile gradient. */
export function gradientCss(c: Pick<ProfileCustom, "gradientFrom" | "gradientTo" | "gradientAngle">): string {
  return `linear-gradient(${c.gradientAngle}deg, ${c.gradientFrom}, ${c.gradientTo})`;
}

function customRef(uid: string) {
  return doc(requireDb(), "users", uid, "profileCustom", "main");
}

/** Read a player's customization; null when they have never saved one or the read fails. */
export async function getProfileCustom(uid: string): Promise<ProfileCustom | null> {
  try {
    const snap = await getDoc(customRef(uid));
    return snap.exists() ? sanitizeProfileCustom(snap.data()) : null;
  } catch (err) {
    logger.warn("profile_custom_read_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Save the signed-in player's customization (sanitized first). Returns what was written. */
export async function saveProfileCustom(uid: string, value: ProfileCustom): Promise<ProfileCustom> {
  const auth = requireAuth();
  if (!auth.currentUser || auth.currentUser.uid !== uid) throw new Error("profile_custom_unauthenticated");
  const clean = sanitizeProfileCustom(value);
  await setDoc(customRef(uid), { ...clean, updatedAt: serverTimestamp() });
  return clean;
}

export interface PinnableClip {
  id: string;
  trickName: string;
  videoUrl: string;
  thumbnailUrl: string | null;
}

/** Only user posts can be pinned or shown on a profile; game clips stay in the game screens. */
function toPinnable(id: string, raw: Record<string, unknown> | undefined): PinnableClip | null {
  if (!raw || !isUserPostedClip(raw)) return null;
  if (typeof raw.videoUrl !== "string" || typeof raw.trickName !== "string") return null;
  return {
    id,
    trickName: raw.trickName,
    videoUrl: raw.videoUrl,
    thumbnailUrl: typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : null,
  };
}

/** The owner's own clips to choose pins from (newest 24 the query returns). */
export async function fetchPinnableClips(uid: string): Promise<PinnableClip[]> {
  try {
    const snap = await getDocs(query(collection(requireDb(), "clips"), where("playerUid", "==", uid), limit(24)));
    return snap.docs.map((d) => toPinnable(d.id, d.data())).filter((c): c is PinnableClip => c !== null);
  } catch (err) {
    logger.warn("profile_custom_clips_failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Resolve pinned clip ids for display, in pin order. A clip that was removed,
 * hidden by moderation or belongs to someone else is skipped silently.
 */
export async function fetchPinnedClips(uid: string, ids: string[]): Promise<PinnableClip[]> {
  const out = await Promise.all(
    ids.slice(0, LIMITS.pinnedClips).map(async (id) => {
      try {
        const snap = await getDoc(doc(requireDb(), "clips", id));
        const raw = snap.exists() ? snap.data() : undefined;
        if (!raw || raw.playerUid !== uid) return null;
        return toPinnable(id, raw);
      } catch {
        return null;
      }
    }),
  );
  return out.filter((c): c is PinnableClip => c !== null);
}

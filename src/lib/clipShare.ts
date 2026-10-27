import type { ShareTextOptions } from "../services/nativeBridge";
import { clipExtFromUrl, clipFileName, clipFileType } from "./clipFile";

/**
 * Origin for links we hand to other apps. The iOS/Android shells run on
 * capacitor://localhost, so the build's VITE_APP_URL wins over the page
 * origin (ci_post_clone.sh fails the iOS build if it is missing).
 */
export function appOrigin(): string {
  return import.meta.env.VITE_APP_URL || window.location.origin;
}

/** Public profile link. `/player/:uid` is the route anyone can open. */
export function publicProfileUrl(uid: string): string {
  return `${appOrigin()}/player/${uid}`;
}

export interface OwnClipShare {
  /** Download URL. It carries a Storage access token: never log it. */
  videoUrl: string;
  trickName: string;
  /** Whose clip it is. The text fallback links to their public profile. */
  ownerUid: string;
}

/**
 * Share options for a clip the viewer owns: the video file itself (the
 * native file on iOS, a fetched File on the web), falling back to a text
 * share that links to the owner's profile when files can't be shared.
 */
export function ownClipShareOptions({ videoUrl, trickName, ownerUid }: OwnClipShare): ShareTextOptions {
  const text = `Check out my ${trickName} on SkateHubba!`;
  return {
    title: `SkateHubba — ${trickName}`,
    text,
    loadFiles: async () => {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();
      const { mime, ext } = clipFileType(blob.type);
      return [new File([blob], clipFileName(trickName, ext), { type: mime })];
    },
    nativeFile: { url: videoUrl, filename: clipFileName(trickName, clipExtFromUrl(videoUrl)) },
    textWithoutFiles: `${text}\n${publicProfileUrl(ownerUid)}`,
  };
}

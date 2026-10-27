import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipDoc } from "../../services/clips";
import { trackEvent } from "../../services/analytics";
import { isShareCancel, shareText } from "../../services/nativeBridge";
import { captureException } from "../../lib/sentry";
import { clipExtFromUrl, clipFileName, clipFileType } from "../../lib/clipFile";
import { RAIL_BTN } from "./feedLayout";

type ShareStatus = "idle" | "sharing" | "shared" | "failed";

/** How long "Shared" / "Share failed" stays on the button before it resets. */
const RESET_MS = 2000;

export interface ShareClipButtonProps {
  clip: ClipDoc;
  isOwnClip: boolean;
}

/**
 * Share button on the feed rail. Any clip in the feed can be shared: the feed
 * only holds approved clips from players the viewer hasn't blocked or
 * reported, so there is nothing hidden to leak.
 *
 * Your own clip shares the video file, the same as the waiting screen. Another
 * player's clip shares a link to their public profile and not the file. The
 * Terms only license a player's video for display inside the app, so we don't
 * hand their file to other apps.
 *
 * Closing the share sheet counts as a choice, not an error, so it is never
 * reported. The analytics event carries no uid, username or URL.
 */
export function ShareClipButton({ clip, isOwnClip }: ShareClipButtonProps) {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const settle = useCallback((next: "shared" | "failed") => {
    setStatus(next);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus("idle"), RESET_MS);
  }, []);

  const handleShare = useCallback(async () => {
    const { trickName, playerUsername, playerUid, videoUrl } = clip;
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    setStatus("sharing");
    try {
      const method = isOwnClip
        ? await shareText({
            title: `SkateHubba — ${trickName}`,
            text: `Check out my ${trickName} on SkateHubba!`,
            loadFiles: async () => {
              const res = await fetch(videoUrl);
              if (!res.ok) throw new Error("Fetch failed");
              const blob = await res.blob();
              const { mime, ext } = clipFileType(blob.type);
              return [new File([blob], clipFileName(trickName, ext), { type: mime })];
            },
            nativeFile: { url: videoUrl, filename: clipFileName(trickName, clipExtFromUrl(videoUrl)) },
            textWithoutFiles: `Check out my ${trickName} on SkateHubba!\n${appUrl}`,
          })
        : await shareText({
            title: `SkateHubba — ${trickName}`,
            // Link in the text, not `url`, so the clipboard fallback keeps it.
            text: `Check out @${playerUsername}'s ${trickName} on SkateHubba!\n${appUrl}/player/${playerUid}`,
          });
      trackEvent("clip_shared", { method, context: "feed", own: isOwnClip });
      settle("shared");
    } catch (err) {
      if (isShareCancel(err)) {
        setStatus("idle");
        return;
      }
      // No URL here: a clip's download URL carries its access token.
      captureException(err, { extra: { context: "ShareClipButton", own: isOwnClip } });
      settle("failed");
    }
  }, [clip, isOwnClip, settle]);

  const who = isOwnClip ? "your" : `@${clip.playerUsername}'s`;
  const label = {
    idle: `Share ${who} ${clip.trickName}`,
    sharing: "Sharing clip",
    shared: "Clip shared",
    failed: "Share failed. Tap to try again",
  }[status];

  const tone = status === "shared" ? "text-brand-green" : status === "failed" ? "text-brand-red" : "text-white";

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        disabled={status === "sharing"}
        aria-label={label}
        className={RAIL_BTN}
      >
        <span className={tone}>{status === "shared" ? <CheckGlyph /> : <ShareGlyph />}</span>
      </button>
      <span role="status" className="sr-only">
        {status === "shared" ? "Clip shared" : status === "failed" ? "Share failed" : ""}
      </span>
    </>
  );
}

function ShareGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

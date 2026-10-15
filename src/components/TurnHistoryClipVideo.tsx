import { useState } from "react";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { captureException } from "../lib/sentry";
import { CLIP_POSTER } from "../lib/clipPoster";

/** Inline clip player that degrades to a placeholder when playback fails. */
export function ClipVideo({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || !isFirebaseStorageUrl(url)) return null;
  if (failed) {
    return (
      <div className="w-full aspect-[9/16] max-w-[280px] mx-auto rounded-xl bg-[#111] border border-border flex items-center justify-center">
        <span className="font-body text-xs text-subtle">Clip no longer available</span>
      </div>
    );
  }

  return (
    <video
      src={url}
      controls
      playsInline
      poster={CLIP_POSTER}
      preload="metadata"
      aria-label={label}
      onError={(e) => {
        setFailed(true);
        captureException(new Error("Video playback failed"), {
          extra: { context: "ClipVideo", url, label, mediaError: (e.target as HTMLVideoElement).error?.message },
        });
      }}
      className="w-full max-w-[280px] mx-auto aspect-[9/16] rounded-xl bg-black object-cover border border-border"
    />
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { trackEvent } from "../../services/analytics";
import { isShareCancel, shareText } from "../../services/nativeBridge";
import { captureException } from "../../lib/sentry";
import { clipExtFromUrl, clipFileName, clipFileType } from "../../lib/clipFile";

export function ClipShareButtons({ videoUrl, trickName }: { videoUrl: string; trickName: string }) {
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [shareStatus, setShareStatus] = useState<"idle" | "sharing" | "shared" | "failed">("idle");
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, []);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch(videoUrl);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const { mime, ext } = clipFileType(blob.type);
      const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
      const objectUrl = URL.createObjectURL(typed);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = clipFileName(trickName, ext);
      a.click();
      safeTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setSaveStatus("saved");
      trackEvent("clip_saved", { context: "waiting_screen" });
      safeTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      // No videoUrl: it carries the clip's Storage access token.
      captureException(err, { extra: { context: "ClipShareButtons.save", trickName } });
      setSaveStatus("failed");
      safeTimeout(() => setSaveStatus("idle"), 2000);
    }
  }, [videoUrl, trickName, safeTimeout]);

  const handleShare = useCallback(async () => {
    setShareStatus("sharing");
    try {
      const loadFiles = async () => {
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error("Fetch failed");
        const blob = await res.blob();
        const { mime, ext } = clipFileType(blob.type);
        return [new File([blob], clipFileName(trickName, ext), { type: mime })];
      };
      const url = import.meta.env.VITE_APP_URL || window.location.origin;
      const method = await shareText({
        title: `SkateHubba — ${trickName}`,
        text: `Check out my ${trickName} on SkateHubba!`,
        loadFiles,
        // iOS app: send the video itself, not just a link.
        nativeFile: { url: videoUrl, filename: clipFileName(trickName, clipExtFromUrl(videoUrl)) },
        textWithoutFiles: `Check out my ${trickName} on SkateHubba!\n${url}`,
      });
      trackEvent("clip_shared", { method, context: "waiting_screen" });
      setShareStatus("shared");
      safeTimeout(() => setShareStatus("idle"), 2000);
    } catch (err) {
      // Closing the sheet is a choice, not an error: no red label, no Sentry.
      if (isShareCancel(err)) {
        setShareStatus("idle");
        return;
      }
      // No videoUrl: it carries the clip's Storage access token.
      captureException(err, { extra: { context: "ClipShareButtons.share", trickName } });
      setShareStatus("failed");
      safeTimeout(() => setShareStatus("idle"), 2000);
    }
  }, [videoUrl, trickName, safeTimeout]);

  const saveLabel = { idle: "Save Clip", saving: "Saving...", saved: "Saved!", failed: "Save failed" }[saveStatus];
  const shareLabel = { idle: "Share Clip", sharing: "Sharing...", shared: "Shared!", failed: "Share failed" }[
    shareStatus
  ];

  // The iOS app's web view has no download handler: the <a download> click is
  // cancelled, so "Saved!" would be a lie. Share still works there. A real
  // save-to-Photos is tracked for 1.2.1.
  const canSave = !Capacitor.isNativePlatform();

  return (
    <div className="flex gap-2 mt-3 w-full max-w-[360px] mx-auto">
      {canSave && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saveStatus === "saving"}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border font-display text-xs tracking-wider transition-colors disabled:opacity-50 ${
            saveStatus === "saved"
              ? "border-brand-green text-brand-green"
              : saveStatus === "failed"
                ? "border-brand-red text-brand-red"
                : "border-border text-muted hover:text-white hover:border-border-hover"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {saveLabel}
        </button>
      )}
      <button
        type="button"
        onClick={handleShare}
        disabled={shareStatus === "sharing"}
        className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border font-display text-xs tracking-wider transition-colors disabled:opacity-50 ${
          shareStatus === "shared"
            ? "border-brand-green text-brand-green"
            : shareStatus === "failed"
              ? "border-brand-red text-brand-red"
              : "border-border text-muted hover:text-white hover:border-border-hover"
        }`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        {shareLabel}
      </button>
    </div>
  );
}

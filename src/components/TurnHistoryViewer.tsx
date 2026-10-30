import { useState, useEffect, useRef, memo } from "react";
import type { TurnRecord } from "../services/games";
import { isFirebaseStorageUrl } from "../utils/helpers";
import { trackEvent } from "../services/analytics";
import { shareText } from "../services/nativeBridge";
import { captureException } from "../lib/sentry";
import { ClipVideo } from "./TurnHistoryClipVideo";
import { ownClipShareOptions } from "../lib/clipShare";

interface TurnHistoryViewerProps {
  turns: TurnRecord[];
  currentUserUid: string;
  /** Expanded by default on game over, collapsed during gameplay. */
  defaultExpanded?: boolean;
  /** Show download buttons on clips (for game over screen). */
  showDownload?: boolean;
  /** Show share buttons on individual clips. */
  showShare?: boolean;
}

export const TurnHistoryViewer = memo(function TurnHistoryViewer({
  turns,
  currentUserUid,
  defaultExpanded = false,
  showDownload = false,
  showShare = false,
}: TurnHistoryViewerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (turns.length === 0) return null;

  return (
    <div className="mt-6">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-border bg-[#111] hover:bg-[#181818] transition-colors"
      >
        <span className="font-display text-sm tracking-wider text-[#aaa]">
          Game Clips ({turns.length} {turns.length === 1 ? "round" : "rounds"})
        </span>
        <span className="text-subtle text-lg">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {turns.map((turn) => {
            const isMyLetter = turn.letterTo === currentUserUid;
            return (
              <div key={turn.turnNumber} className="rounded-xl border border-border bg-[#0D0D0D] p-4">
                {/* Turn header */}
                <div className="flex items-center justify-between mb-3">
                  <span className="font-display text-sm tracking-wider text-white">
                    Round {turn.turnNumber}: {turn.trickName}
                  </span>
                  <span
                    className={`font-display text-sm tracking-wider px-2 py-0.5 rounded-full ${
                      turn.landed
                        ? "bg-[rgba(0,230,118,0.15)] text-brand-green"
                        : "bg-[rgba(255,61,0,0.15)] text-brand-red"
                    }`}
                  >
                    {turn.landed ? "Landed" : "Missed"}
                  </span>
                </div>

                {/* Clips side by side on wider screens, stacked on mobile */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Setter's clip */}
                  <div>
                    <p className="font-display text-sm tracking-wider text-brand-orange mb-1">
                      @{turn.setterUsername}'s trick
                    </p>
                    <ClipVideo url={turn.setVideoUrl || ""} label={`${turn.trickName} set by ${turn.setterUsername}`} />
                    {showDownload && turn.setVideoUrl && isFirebaseStorageUrl(turn.setVideoUrl) && (
                      <DownloadBtn url={turn.setVideoUrl} filename={`skatehubba-round${turn.turnNumber}-set.webm`} />
                    )}
                    {showShare && turn.setVideoUrl && isFirebaseStorageUrl(turn.setVideoUrl) && (
                      <ShareBtn
                        url={turn.setVideoUrl}
                        trickName={turn.trickName}
                        ownerUid={turn.setterUid}
                        context="turn_history"
                      />
                    )}
                  </div>

                  {/* Matcher's clip */}
                  <div>
                    <p className="font-display text-sm tracking-wider text-brand-green mb-1">
                      @{turn.matcherUsername}'s attempt
                    </p>
                    <ClipVideo
                      url={turn.matchVideoUrl || ""}
                      label={`${turn.trickName} attempted by ${turn.matcherUsername}`}
                    />
                    {showDownload && turn.matchVideoUrl && isFirebaseStorageUrl(turn.matchVideoUrl) && (
                      <DownloadBtn
                        url={turn.matchVideoUrl}
                        filename={`skatehubba-round${turn.turnNumber}-match.webm`}
                      />
                    )}
                    {showShare && turn.matchVideoUrl && isFirebaseStorageUrl(turn.matchVideoUrl) && (
                      <ShareBtn
                        url={turn.matchVideoUrl}
                        trickName={turn.trickName}
                        ownerUid={turn.matcherUid}
                        context="turn_history"
                      />
                    )}
                  </div>
                </div>

                {/* Referee ruling indicator */}
                {turn.judgedBy && <p className="font-body text-label text-amber-400/70 mt-2 text-center">Refereed</p>}

                {/* Letter outcome */}
                {!turn.landed && turn.letterTo && (
                  <p className="font-body text-xs text-muted mt-2 text-center">
                    @{turn.letterTo === turn.matcherUid ? turn.matcherUsername : turn.setterUsername} gets a letter
                    {isMyLetter ? " (you)" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

type ClipActionStatus = "idle" | "busy" | "done" | "failed";

/**
 * A clip action button (save, share) that shows a transient "done" or
 * "failed" label for 2s before returning to idle.
 */
function ClipActionBtn({
  labels,
  action,
  onError,
}: {
  labels: Record<ClipActionStatus, string>;
  action: () => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const [status, setStatus] = useState<ClipActionStatus>("idle");
  // Track the pending status-reset timer so an unmount mid-action (e.g.
  // user taps "Rematch" between save and the 2s reset) doesn't fire
  // setState on an unmounted component.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const settle = (next: "done" | "failed") => {
    setStatus(next);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus("idle"), 2000);
  };

  const handleClick = async () => {
    setStatus("busy");
    try {
      await action();
      settle("done");
    } catch (err) {
      onError(err);
      settle("failed");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === "busy"}
      className={`mt-1 w-full text-center font-body text-xs transition-colors disabled:opacity-50 ${
        status === "done" ? "text-brand-green" : status === "failed" ? "text-brand-red" : "text-faint hover:text-[#aaa]"
      }`}
    >
      {labels[status]}
    </button>
  );
}

const DOWNLOAD_LABELS = { idle: "Save clip", busy: "Saving...", done: "Saved!", failed: "Save failed" };
const SHARE_LABELS = { idle: "Share clip", busy: "Sharing...", done: "Shared!", failed: "Share failed" };

function DownloadBtn({ url, filename }: { url: string; filename: string }) {
  return (
    <ClipActionBtn
      labels={DOWNLOAD_LABELS}
      action={async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        a.click();
        // Delay revocation so the browser has time to start the download
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      }}
      // No url: it carries the clip's Storage access token.
      onError={(err) => captureException(err, { extra: { context: "DownloadBtn", filename } })}
    />
  );
}

function ShareBtn({
  url,
  trickName,
  ownerUid,
  context,
}: {
  url: string;
  trickName: string;
  ownerUid: string;
  context: string;
}) {
  return (
    <ClipActionBtn
      labels={SHARE_LABELS}
      action={async () => {
        const method = await shareText(ownClipShareOptions({ videoUrl: url, trickName, ownerUid }));
        trackEvent("clip_shared", { method, context });
      }}
      // No url: it carries the clip's Storage access token.
      onError={(err) => captureException(err, { extra: { context: "ShareBtn", trickName } })}
    />
  );
}

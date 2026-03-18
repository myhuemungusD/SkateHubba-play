import { useState } from "react";
import type { TurnRecord } from "../services/games";
import { isFirebaseStorageUrl } from "../utils/helpers";

interface TurnHistoryViewerProps {
  turns: TurnRecord[];
  currentUserUid: string;
  /** Expanded by default on game over, collapsed during gameplay. */
  defaultExpanded?: boolean;
  /** Show download buttons on clips (for game over screen). */
  showDownload?: boolean;
}

function ClipVideo({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || !isFirebaseStorageUrl(url)) return null;
  if (failed) {
    return (
      <div className="w-full aspect-[9/16] max-w-[280px] mx-auto rounded-xl bg-[#111] border border-border flex items-center justify-center">
        <span className="font-body text-xs text-[#555]">Clip no longer available</span>
      </div>
    );
  }

  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      onError={() => setFailed(true)}
      className="w-full max-w-[280px] mx-auto aspect-[9/16] rounded-xl bg-black object-cover border border-border"
    />
  );
}

export function TurnHistoryViewer({
  turns,
  currentUserUid,
  defaultExpanded = false,
  showDownload = false,
}: TurnHistoryViewerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (turns.length === 0) return null;

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between py-2 px-3 rounded-lg border border-border bg-[#111] hover:bg-[#181818] transition-colors"
      >
        <span className="font-display text-sm tracking-wider text-[#aaa]">
          Game Clips ({turns.length} {turns.length === 1 ? "round" : "rounds"})
        </span>
        <span className="text-[#555] text-lg">{expanded ? "▲" : "▼"}</span>
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
                    className={`font-display text-xs tracking-wider px-2 py-0.5 rounded-full ${
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
                    <p className="font-display text-xs tracking-wider text-brand-orange mb-1">
                      @{turn.setterUsername}'s trick
                    </p>
                    <ClipVideo url={turn.setVideoUrl || ""} label={`${turn.trickName} set by ${turn.setterUsername}`} />
                    {showDownload && turn.setVideoUrl && isFirebaseStorageUrl(turn.setVideoUrl) && (
                      <DownloadBtn url={turn.setVideoUrl} filename={`skatehubba-round${turn.turnNumber}-set.webm`} />
                    )}
                  </div>

                  {/* Matcher's clip */}
                  <div>
                    <p className="font-display text-xs tracking-wider text-brand-green mb-1">
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
                  </div>
                </div>

                {/* Letter outcome */}
                {!turn.landed && turn.letterTo && (
                  <p className="font-body text-xs text-[#888] mt-2 text-center">
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
}

function DownloadBtn({ url, filename }: { url: string; filename: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      // Silently fail — clip may have expired
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="mt-1 w-full text-center font-body text-xs text-[#666] hover:text-[#aaa] transition-colors disabled:opacity-50"
    >
      {downloading ? "Saving..." : "Save clip"}
    </button>
  );
}

import { memo } from "react";
import { FlagIcon, GavelIcon } from "../icons";
import { Timer } from "../Timer";
import { isFirebaseStorageUrl } from "../../utils/helpers";
import { landShare, totalVotes, type Dispute, type DisputeTally, type DisputeVerdict } from "../../types/dispute";
import { ABOVE_NAV, BELOW_HEADER, FEED_SLIDE, RAIL_BTN } from "./feedLayout";
import { CLIP_POSTER } from "../../lib/clipPoster";
import { SpotlightVideo } from "./SpotlightVideo";

export interface DisputeCardProps {
  dispute: Dispute;
  tally: DisputeTally;
  /** How this viewer ruled, or null if they haven't (or never could). */
  ownVerdict: DisputeVerdict | null;
  /** False for the two players in the game and for a closed dispute. */
  canVote: boolean;
  /** True while this dispute's verdict write is in flight — locks both buttons. */
  voting: boolean;
  /** Vote-window close time (ms), or null when unknown. Derived from the dispute. */
  deadline: number | null;
  onVerdict: (dispute: Dispute, verdict: DisputeVerdict) => void;
  /** Opens the existing report flow for this attempt. Omitted for the matcher. */
  onReport?: (dispute: Dispute) => void;
  /** Snapped page. Controls mount only here so an off-screen LAND can't be tapped. */
  active?: boolean;
  /** Mount the attempt video. False for slides far from the viewport. */
  near?: boolean;
  muted?: boolean;
  onToggleMute?: () => void;
}

/**
 * A disputed trick as one full-screen page in the same scroller as clips.
 *
 * The banner names the call, the tally, and the time left. LAND / BAIL sit
 * on the side and only while `canVote` is true. Ruling replaces them with
 * the tally and leaves the page where it is — the feed never auto-advances.
 */
export const DisputeCard = memo(function DisputeCard({
  dispute,
  tally,
  ownVerdict,
  canVote,
  voting,
  deadline,
  onVerdict,
  onReport,
  active = true,
  near = true,
  muted = true,
  onToggleMute,
}: DisputeCardProps) {
  const showButtons = canVote && ownVerdict === null;
  const attemptUrl = isFirebaseStorageUrl(dispute.matchVideoUrl) ? dispute.matchVideoUrl : null;
  const setUrl = dispute.setVideoUrl && isFirebaseStorageUrl(dispute.setVideoUrl) ? dispute.setVideoUrl : null;

  return (
    <article
      data-feed-slide
      data-active={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
      aria-label={`Community call on ${dispute.trickName}`}
      className={FEED_SLIDE}
    >
      {near && attemptUrl ? (
        <SpotlightVideo
          src={attemptUrl}
          active={active}
          muted={muted}
          onToggleMute={onToggleMute}
          mediaLabel={`${dispute.matcherUsername}'s attempt at ${dispute.trickName}`}
        />
      ) : (
        <img
          src={CLIP_POSTER}
          alt=""
          width={360}
          height={640}
          decoding="async"
          loading="lazy"
          className="absolute inset-0 h-full w-full bg-black object-cover"
        />
      )}

      {active && (
        <>
          <div className={`absolute left-4 right-20 z-20 ${BELOW_HEADER}`}>
            <p className="inline-flex max-w-full items-center gap-1.5 rounded-2xl border border-amber-400/40 bg-black/60 px-3 py-1.5 font-display text-[11px] leading-snug tracking-[0.14em] text-amber-300 backdrop-blur-sm">
              <GavelIcon size={13} className="shrink-0 text-amber-300" />
              <span>Community call: Landed or bailed?</span>
            </p>
            <h2 className="mt-3 font-display text-2xl leading-tight tracking-wide text-white drop-shadow">
              {dispute.trickName}
            </h2>
            <p className="mt-1 font-body text-sm text-white/80">
              @{dispute.matcherUsername} says they landed @{dispute.setterUsername}&apos;s trick.{" "}
              <span className="whitespace-nowrap text-white">Did they?</span>
            </p>
            <p className="mt-2 font-display text-[11px] tracking-[0.14em] text-white/80 tabular-nums">
              <span className={ownVerdict === "land" ? "text-brand-green" : "text-brand-green/80"}>
                LAND {tally.land}
              </span>
              <span className="mx-1.5 text-white/40">·</span>
              <span className={ownVerdict === "bail" ? "text-brand-red" : "text-brand-red/80"}>BAIL {tally.bail}</span>
              <span className="mx-1.5 text-white/40">·</span>
              <span className="text-white/60">Turn {dispute.turnNumber}</span>
            </p>
            {deadline !== null && (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-body text-[11px] text-white/70">Time left</span>
                <Timer deadline={deadline} />
              </div>
            )}
            {!showButtons && <DisputeTallyMeter tally={tally} ownVerdict={ownVerdict} />}
            {!attemptUrl && (
              <p className="mt-4 font-body text-sm text-white/70">This attempt&apos;s video is unavailable.</p>
            )}
            {onReport && (
              <button
                type="button"
                onClick={() => onReport(dispute)}
                aria-label={`Report @${dispute.matcherUsername}'s attempt`}
                className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-1 font-display text-[11px] tracking-[0.15em] text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                <FlagIcon size={14} />
                REPORT
              </button>
            )}
            {setUrl && (
              <details className="mt-3">
                <summary
                  aria-label={`Watch @${dispute.setterUsername}'s original set of ${dispute.trickName}`}
                  className="flex min-h-[44px] cursor-pointer list-none items-center font-display text-[11px] tracking-[0.15em] text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                >
                  WATCH THE SET · @{dispute.setterUsername.toUpperCase()}
                </summary>
                <video
                  src={setUrl}
                  controls
                  playsInline
                  poster={CLIP_POSTER}
                  preload="none"
                  aria-label={`${dispute.setterUsername}'s ${dispute.trickName} set video`}
                  className="mt-2 max-h-[240px] w-full rounded-xl border border-white/10 bg-black object-cover"
                />
              </details>
            )}
          </div>

          {showButtons && (
            <div
              role="group"
              aria-label={`Rule on ${dispute.trickName}`}
              className={`absolute right-3 z-20 flex flex-col gap-3 ${ABOVE_NAV}`}
            >
              <button
                type="button"
                onClick={() => onVerdict(dispute, "land")}
                disabled={voting}
                aria-label={`Land — @${dispute.matcherUsername} landed it`}
                className={`${RAIL_BTN} border-brand-green/50 bg-brand-green/20 text-brand-green`}
              >
                <span className="font-display text-[11px] tracking-wider">LAND</span>
              </button>
              <button
                type="button"
                onClick={() => onVerdict(dispute, "bail")}
                disabled={voting}
                aria-label={`Bail — @${dispute.matcherUsername} bailed`}
                className={`${RAIL_BTN} border-brand-red/50 bg-brand-red/20 text-brand-red`}
              >
                <span className="font-display text-[11px] tracking-wider">BAIL</span>
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
});

function DisputeTallyMeter({ tally, ownVerdict }: { tally: DisputeTally; ownVerdict: DisputeVerdict | null }) {
  const total = totalVotes(tally);
  const landWidth = `${landShare(tally) * 100}%`;

  return (
    <div className="mt-3 max-w-sm rounded-xl bg-black/50 p-2 backdrop-blur-sm">
      <div
        role="img"
        aria-label={`${tally.land} land, ${tally.bail} bail — ${total} ${total === 1 ? "call" : "calls"} in`}
        className="h-2 w-full overflow-hidden rounded-full border border-white/[0.06] bg-brand-red/40"
      >
        <div
          className="h-full bg-brand-green motion-safe:transition-[width] motion-safe:duration-500 ease-smooth"
          style={{ width: landWidth }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="font-body text-[11px] text-white/70 tabular-nums">
          {total === 0 ? "No calls in yet" : `${total} ${total === 1 ? "call" : "calls"} in`}
        </p>
        {ownVerdict && (
          <span
            className={`rounded-md border px-2 py-1 font-display text-[10px] tracking-[0.15em] ${
              ownVerdict === "land"
                ? "border-brand-green/40 bg-brand-green/10 text-brand-green"
                : "border-brand-red/40 bg-brand-red/10 text-brand-red"
            }`}
          >
            YOUR CALL · {ownVerdict === "land" ? "LAND" : "BAIL"}
          </span>
        )}
      </div>
    </div>
  );
}

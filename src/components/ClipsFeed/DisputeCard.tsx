import { memo } from "react";
import { GavelIcon } from "../icons";
import { Timer } from "../Timer";
import { isFirebaseStorageUrl } from "../../utils/helpers";
import { landShare, totalVotes, type Dispute, type DisputeTally, type DisputeVerdict } from "../../types/dispute";

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
}

/**
 * A disputed trick in the lobby feed, judged LAND or BAIL by the community.
 *
 * The hero is the matcher's attempt — the claim actually under judgement.
 * It uses native `controls` rather than {@link SpotlightVideo}: judging is a
 * scrub-and-rewatch job, several cards can sit in the lane at once (autoplay
 * would have them fighting over the audio channel and the network), and
 * SpotlightVideo's end-of-clip REPLAY / NEXT TRICK overlay has no meaning
 * here. The setter's clip is secondary context, collapsed behind a
 * disclosure so the card stays a single decision.
 *
 * Every `src` is gated through `isFirebaseStorageUrl` before it reaches the
 * DOM — the same defence the game screen applies to URLs read off a doc.
 *
 * memo: the lane re-renders on every tally mutation across every card; the
 * shallow comparator keeps an unrelated vote from re-rendering this card's
 * video element.
 */
export const DisputeCard = memo(function DisputeCard({
  dispute,
  tally,
  ownVerdict,
  canVote,
  voting,
  deadline,
  onVerdict,
}: DisputeCardProps) {
  const showButtons = canVote && ownVerdict === null;
  const attemptUrl = isFirebaseStorageUrl(dispute.matchVideoUrl) ? dispute.matchVideoUrl : null;
  const setUrl = dispute.setVideoUrl && isFirebaseStorageUrl(dispute.setVideoUrl) ? dispute.setVideoUrl : null;

  return (
    <article
      className="glass-card rounded-2xl overflow-hidden border border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]"
      aria-label={`Community call on ${dispute.trickName}`}
    >
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-display text-[11px] tracking-[0.2em] text-amber-400">
          <GavelIcon size={13} className="text-amber-400" />
          COMMUNITY CALL
        </span>
        <span className="font-body text-[11px] text-faint">Turn {dispute.turnNumber}</span>
      </div>

      <div className="px-4">
        <h2 className="font-display text-xl text-white tracking-wide leading-tight">{dispute.trickName}</h2>
        <p className="font-body text-sm text-muted mt-1">
          @{dispute.matcherUsername} says they landed @{dispute.setterUsername}&apos;s trick.{" "}
          {/* nowrap: the question is the call to action — letting it break
              across lines orphans "they?" and buries the ask. Two words, so
              it can never overflow a card this wide. */}
          <span className="text-white/80 whitespace-nowrap">Did they?</span>
        </p>
      </div>

      {deadline !== null && (
        <div className="px-4 pt-3 flex items-center gap-2">
          <span className="font-body text-[11px] text-faint">Voting closes in</span>
          <Timer deadline={deadline} />
        </div>
      )}

      <div className="px-4 pt-3">
        {attemptUrl ? (
          <video
            src={attemptUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={`${dispute.matcherUsername}'s attempt at ${dispute.trickName}`}
            className="w-full aspect-[9/16] max-h-[480px] rounded-xl bg-black object-cover border border-border"
          />
        ) : (
          <p className="font-body text-sm text-faint py-6 text-center border border-dashed border-white/[0.06] rounded-xl">
            This attempt&apos;s video is unavailable.
          </p>
        )}
      </div>

      {setUrl && (
        <details className="px-4 pt-3 group">
          <summary
            aria-label={`Watch @${dispute.setterUsername}'s original set of ${dispute.trickName}`}
            className="min-h-[44px] flex items-center font-display text-[11px] tracking-[0.15em] text-brand-orange cursor-pointer list-none rounded-xl px-2 -mx-2 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            WATCH THE SET · @{dispute.setterUsername.toUpperCase()}
          </summary>
          <video
            src={setUrl}
            controls
            playsInline
            preload="none"
            aria-label={`${dispute.setterUsername}'s ${dispute.trickName} set video`}
            className="mt-2 w-full aspect-[9/16] max-h-[320px] rounded-xl bg-black object-cover border border-border"
          />
        </details>
      )}

      {showButtons ? (
        <div
          role="group"
          aria-label={`Rule on ${dispute.trickName}`}
          className="px-4 pt-3 pb-4 flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => onVerdict(dispute, "land")}
            disabled={voting}
            aria-label={`Make — @${dispute.matcherUsername} made it`}
            className="flex-1 min-h-[44px] flex flex-col items-center justify-center rounded-xl font-display text-sm tracking-wider bg-brand-green/15 border border-brand-green/40 text-brand-green hover:bg-brand-green/25 active:scale-[0.97] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
          >
            <span>MAKE</span>
            <span className="font-body text-[10px] tracking-normal text-brand-green/70">They made it</span>
          </button>
          <button
            type="button"
            onClick={() => onVerdict(dispute, "bail")}
            disabled={voting}
            aria-label={`Bail — @${dispute.matcherUsername} did not make it`}
            className="flex-1 min-h-[44px] flex flex-col items-center justify-center rounded-xl font-display text-sm tracking-wider bg-brand-red/15 border border-brand-red/40 text-brand-red hover:bg-brand-red/25 active:scale-[0.97] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
          >
            <span>BAIL</span>
            <span className="font-body text-[10px] tracking-normal text-brand-red/70">Didn&apos;t make it</span>
          </button>
        </div>
      ) : (
        <DisputeTallyMeter tally={tally} ownVerdict={ownVerdict} />
      )}
    </article>
  );
});

/**
 * LAND / BAIL split meter plus the raw counts. Replaces the buttons once the
 * viewer has ruled — or straight away when they never could (they're in the
 * game, or voting has closed).
 */
function DisputeTallyMeter({ tally, ownVerdict }: { tally: DisputeTally; ownVerdict: DisputeVerdict | null }) {
  const total = totalVotes(tally);
  // Runtime-computed width — the one legitimate inline style on this surface.
  const landWidth = `${landShare(tally) * 100}%`;

  return (
    <div className="px-4 pt-3 pb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span
          className={`font-display text-[11px] tracking-[0.15em] tabular-nums ${
            ownVerdict === "land" ? "text-brand-green" : "text-brand-green/70"
          }`}
        >
          MAKE {tally.land}
        </span>
        <span
          className={`font-display text-[11px] tracking-[0.15em] tabular-nums ${
            ownVerdict === "bail" ? "text-brand-red" : "text-brand-red/70"
          }`}
        >
          {tally.bail} BAIL
        </span>
      </div>

      <div
        role="img"
        aria-label={`${tally.land} make, ${tally.bail} bail — ${total} ${total === 1 ? "call" : "calls"} in`}
        className="h-2 w-full rounded-full bg-brand-red/40 overflow-hidden border border-white/[0.06]"
      >
        {/* motion-safe: the meter snaps rather than slides for viewers who
            asked for reduced motion. */}
        <div
          className="h-full bg-brand-green motion-safe:transition-[width] motion-safe:duration-500 ease-smooth"
          style={{ width: landWidth }}
        />
      </div>

      <div className="flex items-center justify-between mt-2">
        <p className="font-body text-[11px] text-faint tabular-nums">
          {total === 0 ? "No calls in yet" : `${total} ${total === 1 ? "call" : "calls"} in`}
        </p>
        {ownVerdict && (
          <span
            className={`font-display text-[10px] tracking-[0.15em] px-2 py-1 rounded-md border ${
              ownVerdict === "land"
                ? "text-brand-green border-brand-green/40 bg-brand-green/10"
                : "text-brand-red border-brand-red/40 bg-brand-red/10"
            }`}
          >
            YOUR CALL · {ownVerdict === "land" ? "MAKE" : "BAIL"}
          </span>
        )}
      </div>
    </div>
  );
}

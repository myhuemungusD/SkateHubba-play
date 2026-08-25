import type { Dispute } from "../types/dispute";

const RESULT_COPY = {
  land: { title: "LAND", effect: "The community upheld the landing. No letter was given, and play moved on." },
  bail: { title: "BAIL", effect: "The community overturned the landing. The matcher received a letter." },
  tie: {
    title: "TIE",
    effect: "The vote was tied. No letter was given, and the matcher was asked to retry the trick.",
  },
  none: {
    title: "NO VOTES",
    effect: "No usable votes were cast. The landing stood, no letter was given, and play moved on.",
  },
} as const;

export function DisputeResultCard({ dispute }: { dispute: Dispute }) {
  const result = dispute.verdict ? RESULT_COPY[dispute.verdict] : null;
  return (
    <section
      aria-labelledby="dispute-result-title"
      className="w-full mb-6 rounded-2xl border border-brand-orange/30 bg-black/30 p-4 text-left"
    >
      <p className="font-display text-[10px] tracking-[0.18em] text-brand-orange">COMMUNITY VERDICT</p>
      <h2 id="dispute-result-title" className="mt-1 font-display text-xl text-white">
        {result?.title ?? "RESULT UNAVAILABLE"}
      </h2>
      <p className="mt-1 font-body text-sm text-white">{dispute.trickName}</p>
      <div className="mt-3 flex gap-4 font-display text-xs" aria-label="Final vote totals">
        <span className="text-brand-green">LAND {dispute.landVotes}</span>
        <span className="text-brand-red">BAIL {dispute.bailVotes}</span>
      </div>
      <p className="mt-3 font-body text-xs leading-relaxed text-muted">
        {result?.effect ??
          "This older dispute was closed without a recorded verdict, so its effect on the game is unavailable."}
      </p>
    </section>
  );
}

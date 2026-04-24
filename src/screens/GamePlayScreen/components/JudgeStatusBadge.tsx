import type { GameDoc } from "../../../services/games";

export function JudgeStatusBadge({ game, viewerIsJudge }: { game: GameDoc; viewerIsJudge: boolean }) {
  if (viewerIsJudge) return null;
  if (!game.judgeUsername || game.status !== "active") return null;

  if (game.judgeStatus === "pending") {
    return (
      <div
        className="mb-4 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle"
        data-testid="judge-pending-badge"
      >
        <span className="font-display tracking-wider">REFEREE PENDING</span>
        <span className="font-body">@{game.judgeUsername} — honor system applies</span>
      </div>
    );
  }
  if (game.judgeStatus === "accepted") {
    return (
      <div
        className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-orange/30 bg-brand-orange/[0.06] px-3 py-1 text-[11px] text-brand-orange"
        data-testid="judge-active-badge"
      >
        <span className="font-display tracking-wider">REFEREE</span>
        <span className="font-body">@{game.judgeUsername} rules disputes</span>
      </div>
    );
  }
  if (game.judgeStatus === "declined") {
    return (
      <div
        className="mb-4 inline-flex items-center gap-2 rounded-full border border-subtle/40 bg-white/[0.03] px-3 py-1 text-[11px] text-subtle"
        data-testid="judge-declined-badge"
      >
        <span className="font-display tracking-wider">NO REFEREE</span>
        <span className="font-body">Honor system</span>
      </div>
    );
  }
  return null;
}

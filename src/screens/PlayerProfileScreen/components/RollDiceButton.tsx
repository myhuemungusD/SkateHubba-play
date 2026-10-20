import { useNavigate } from "react-router";

/** Starts a Roll Dice challenge with this profile. The parent mounts it only when the flag is on. */
export function RollDiceButton({ opponentUid, opponentUsername }: { opponentUid: string; opponentUsername: string }) {
  const navigate = useNavigate();
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => navigate("/dice/new", { state: { opponent: { uid: opponentUid, username: opponentUsername } } })}
        className="w-full min-h-[44px] rounded-xl border border-white/[0.06] bg-surface font-display text-xs tracking-wider text-white"
      >
        Roll Dice
      </button>
    </div>
  );
}

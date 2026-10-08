import { useNavigate } from "react-router";

/** Lobby entry for Roll Dice. Rendered only while the feature flag is on. */
export function RollDiceCard() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="roll-dice-card"
      onClick={() => navigate("/dice")}
      className="mb-5 w-full rounded-2xl border border-white/[0.06] bg-surface px-4 py-4 text-left shadow-card hover:border-brand-orange/40"
    >
      <span className="block font-display tracking-wider text-white">Roll Dice</span>
      <span className="mt-1 block font-body text-xs text-muted">Street dice. Wins and losses only.</span>
    </button>
  );
}

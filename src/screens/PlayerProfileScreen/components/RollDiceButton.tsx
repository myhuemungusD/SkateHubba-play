import { useState } from "react";
import { useNavigate } from "react-router";
import { createDiceGame, diceErrorMessage } from "../../../services/dice";

/** Opens a Roll Dice match with this profile. The parent mounts it only when the flag is on. */
export function RollDiceButton({ opponentUid }: { opponentUid: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function roll(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createDiceGame(opponentUid);
      navigate(`/dice/${result.gameId}`);
    } catch (err) {
      setError(diceErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        disabled={busy}
        onClick={() => void roll()}
        className="w-full min-h-[44px] rounded-xl border border-white/[0.06] bg-surface font-display text-xs tracking-wider text-white"
      >
        Roll Dice
      </button>
      {error ? (
        <p role="alert" className="mt-2 font-body text-xs text-brand-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router";
import { OpponentPicker } from "../../components/OpponentPicker";
import { useAuthContext } from "../../context/AuthContext";
import { createDiceGame, diceErrorMessage } from "../../services/dice";
import { getUidByUsername } from "../../services/users";

/** /dice/new — pick a skater and open a C-Lo match. */
export function DiceNew() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(username: string): Promise<void> {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const opponentUid = await getUidByUsername(username);
      if (!opponentUid) {
        setError("No skater with that name.");
        return;
      }
      const result = await createDiceGame(opponentUid);
      navigate(`/dice/${result.gameId}`);
    } catch (err) {
      setError(diceErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-background px-5 pb-24 pt-[max(env(safe-area-inset-top),2rem)]">
      <button
        type="button"
        onClick={() => navigate("/dice")}
        className="inline-flex min-h-11 items-center font-body text-sm text-bright"
      >
        Back
      </button>
      <h1 className="mt-4 font-display text-3xl tracking-wider text-white">Roll someone</h1>
      <p className="mt-2 mb-6 font-body text-sm text-muted">Same people you can challenge to S.K.A.T.E.</p>
      {user ? (
        <OpponentPicker viewerUid={user.uid} collapsed={busy} onSelect={(username) => void pick(username)} />
      ) : (
        <p className="font-body text-sm text-muted">Sign in to roll.</p>
      )}
      {error ? (
        <p role="alert" className="mt-4 font-body text-sm text-brand-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

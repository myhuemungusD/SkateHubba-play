import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ActionDock } from "../../components/ActionDock";
import { Btn } from "../../components/ui/Btn";
import { Die } from "../../components/dice/Die";
import { useAuthContext } from "../../context/AuthContext";
import { useDiceGame } from "../../hooks/useDice";
import {
  claimDiceTimeout,
  createDiceGame,
  declineDice,
  diceErrorMessage,
  quitDice,
  rollDice,
} from "../../services/dice";
import { diceEndLine, opponentName, opponentUid } from "./diceCopy";

/** /dice/:gameId — one C-Lo match, round after round, until somebody leaves. */
export function DiceTable() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const uid = user?.uid ?? "";
  const { game, loading, missing } = useDiceGame(gameId);
  const [error, setError] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const claimed = useRef<string | null>(null);

  useEffect(() => {
    if (!game || game.status !== "active" || game.turnDeadline > Date.now()) return;
    const key = `${game.id}:${game.turnDeadline}`;
    if (claimed.current === key) return;
    claimed.current = key;
    void claimDiceTimeout(game.id).catch((err) => setError(diceErrorMessage(err)));
  }, [game]);

  async function run(action: () => Promise<unknown>, spin: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    if (spin) setRolling(true);
    try {
      await action();
    } catch (err) {
      setError(diceErrorMessage(err));
    } finally {
      setRolling(false);
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="px-5 pt-8 font-body text-sm text-muted">Loading the table…</p>;
  }
  if (missing || !game) {
    return (
      <div className="px-5 pt-8">
        <p className="font-body text-sm text-muted">That match is gone.</p>
        <button
          type="button"
          onClick={() => navigate("/dice")}
          className="mt-4 inline-flex min-h-11 items-center font-body text-sm text-brand-orange"
        >
          Back to Roll Dice
        </button>
      </div>
    );
  }

  const mine = uid === game.currentTurn && game.status === "active";
  const name = opponentName(game.player1Uid, game.player1Username, game.player2Username, uid);
  const canDecline =
    game.status === "active" && uid === game.player2Uid && game.round === 1 && game.rollCount === 0 && !game.lastRoll;
  const banner = diceEndLine(game.status, game.endReason, game.winner, uid);
  const faces = game.lastRoll?.dice ?? [1, 1, 1];
  const scoreLeft = game.roundsWon[game.player1Uid] ?? 0;
  const scoreRight = game.roundsWon[game.player2Uid] ?? 0;

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-background px-5 pb-[calc(14rem+env(safe-area-inset-bottom))] pt-[max(env(safe-area-inset-top),2rem)]">
      <button
        type="button"
        onClick={() => navigate("/dice")}
        className="inline-flex min-h-11 items-center font-body text-sm text-bright"
      >
        Back
      </button>
      <h1 className="mt-4 font-display text-3xl tracking-wider text-white">Roll Dice</h1>
      <p className="mt-2 font-body text-sm text-muted">
        vs @{name || "skater"} · round {game.round} · {scoreLeft}–{scoreRight}
      </p>
      {banner ? <p className="mt-4 font-display text-lg tracking-wider text-brand-orange">{banner}</p> : null}
      <div className="mt-8 flex justify-center gap-3" aria-label={game.lastRoll ? game.lastRoll.label : "No roll yet"}>
        {faces.map((face, index) => (
          <Die key={`${game.lastRoll?.label ?? "blank"}-${index}`} face={face} tumbling={rolling} />
        ))}
      </div>
      {game.lastRoll ? (
        <p className="mt-4 text-center font-display tracking-wider text-white">{game.lastRoll.label}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 font-body text-sm text-brand-red">
          {error}
        </p>
      ) : null}
      {game.status === "active" && !mine ? (
        <p className="mt-8 text-center font-body text-sm text-muted">Waiting on @{name || "them"}.</p>
      ) : null}
      <ActionDock testId="dice-actions">
        {mine ? (
          <Btn onClick={() => void run(() => rollDice(game.id), true)} disabled={busy}>
            ROLL
          </Btn>
        ) : null}
        {canDecline ? (
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center font-body text-sm text-bright"
            onClick={() => void run(() => declineDice(game.id), false)}
          >
            Decline
          </button>
        ) : null}
        {game.status === "active" ? (
          <button
            type="button"
            className="mt-1 inline-flex min-h-11 w-full items-center justify-center font-body text-sm text-bright"
            onClick={() => void run(() => quitDice(game.id), false)}
          >
            Leave the match
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/20 py-3 font-display tracking-wider text-white"
            onClick={() =>
              void run(async () => {
                const next = await createDiceGame(opponentUid(game.player1Uid, game.player2Uid, uid));
                navigate(`/dice/${next.gameId}`);
              }, false)
            }
          >
            Run it back
          </button>
        )}
      </ActionDock>
    </div>
  );
}

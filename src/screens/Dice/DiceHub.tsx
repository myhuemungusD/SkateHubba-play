import { useNavigate } from "react-router";
import { useAuthContext } from "../../context/AuthContext";
import { useMyDiceGames } from "../../hooks/useDice";
import type { DiceGameDoc } from "../../services/dice";
import { opponentName } from "./diceCopy";

function rowLabel(game: DiceGameDoc, uid: string): string {
  const name = opponentName(game.player1Uid, game.player1Username, game.player2Username, uid);
  const mine = game.roundsWon[uid] ?? 0;
  const theirs = game.roundsWon[game.player1Uid === uid ? game.player2Uid : game.player1Uid] ?? 0;
  if (game.status === "active") return `${name} · round ${game.round} · ${mine}–${theirs}`;
  return `${name} · ${mine}–${theirs}`;
}

/** /dice — open matches and lifetime dice wins and losses. */
export function DiceHub() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const uid = user?.uid ?? "";
  const { games, stats, loading } = useMyDiceGames(uid.length > 0 ? uid : null);

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-background px-5 pb-24 pt-[max(env(safe-area-inset-top),2rem)]">
      <h1 className="font-display text-3xl tracking-wider text-white">Roll Dice</h1>
      <p className="mt-2 font-body text-sm text-muted">Street dice with another skater. Wins and losses only.</p>
      <p className="mt-4 font-display text-sm tracking-wider text-brand-orange" data-testid="dice-record">
        {stats.wins}–{stats.losses}
      </p>
      <button
        type="button"
        onClick={() => navigate("/dice/new")}
        className="mt-6 w-full rounded-2xl bg-brand-orange py-4 font-display tracking-wider text-white"
      >
        Roll someone
      </button>
      {loading ? <p className="mt-8 font-body text-sm text-muted">Loading matches…</p> : null}
      {!loading && games.length === 0 ? (
        <p className="mt-8 font-body text-sm text-muted">No dice matches yet.</p>
      ) : null}
      <ul className="mt-6 space-y-3">
        {games.map((game) => (
          <li key={game.id}>
            <button
              type="button"
              onClick={() => navigate(`/dice/${game.id}`)}
              className="flex min-h-11 w-full items-center rounded-2xl border border-white/[0.06] bg-surface px-4 py-3 text-left font-body text-sm text-white"
            >
              {rowLabel(game, uid)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

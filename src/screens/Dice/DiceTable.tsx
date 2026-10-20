import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useAuthContext } from "../../context/AuthContext";
import { useDiceGame } from "../../hooks/useDice";
import { TableView } from "./TableView";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-background px-4 pt-[max(env(safe-area-inset-top),1.25rem)]">
      <ScreenHeader title="Roll Dice" fallback="/dice" />
      {children}
    </div>
  );
}

/** /dice/:gameId — loads the match, then hands it to the table. */
export function DiceTable() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { game, loading, missing } = useDiceGame(gameId);

  if (loading) {
    return (
      <Shell>
        <div
          className="mt-4 space-y-2"
          aria-busy="true"
          aria-label="Loading the match"
          data-testid="dice-table-loading"
        >
          <div className="h-[68px] animate-pulse rounded-2xl bg-white/[0.05]" />
          <div className="h-[68px] animate-pulse rounded-2xl bg-white/[0.05]" />
          <div className="mt-4 h-48 animate-pulse rounded-[20px] bg-white/[0.05]" />
        </div>
      </Shell>
    );
  }
  if (missing || !game || !user) {
    return (
      <Shell>
        <p className="mt-6 font-body text-sm text-bright">This match isn't here anymore, or you're not in it.</p>
        <button
          type="button"
          onClick={() => navigate("/dice")}
          className="mt-3 inline-flex min-h-11 items-center font-body text-sm text-brand-orange"
        >
          Back to Roll Dice
        </button>
      </Shell>
    );
  }
  return <TableView key={game.id} game={game} uid={user.uid} />;
}

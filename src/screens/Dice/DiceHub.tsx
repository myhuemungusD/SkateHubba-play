import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { CircleHelp } from "lucide-react";
import { RecordFigure } from "../../components/RecordFigure";
import { ScreenHeader } from "../../components/ScreenHeader";
import { MatchRow } from "../../components/dice/MatchRow";
import { Btn } from "../../components/ui/Btn";
import { useAuthContext } from "../../context/AuthContext";
import { useMyDiceGames } from "../../hooks/useDice";
import type { DiceGameDoc } from "../../services/dice";
import { DiceInfoSheet } from "./DiceInfoSheet";
import { fmt } from "./diceCopy";
import { rowOf, sectionOf, type HubSection } from "./hubRows";

const TITLES: Record<HubSection, string> = { move: "Your move", wait: "Waiting on them", done: "Finished" };
const DONE_SHOWN = 8;

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface bg-grip px-3 py-3">
      <p className="font-display text-xs tracking-[0.18em] text-muted">{label}</p>
      <p className="font-display text-3xl leading-tight tabular-nums text-white">{value}</p>
      <p className="truncate font-body text-[11px] text-muted">{sub}</p>
    </div>
  );
}

/** /dice — your Rep, your record, and every match sorted by whose move it is. */
export function DiceHub() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const uid = user?.uid ?? "";
  const { games, stats, loading, error, retry } = useMyDiceGames(uid.length > 0 ? uid : null);
  const [now] = useState(() => Date.now());
  const [info, setInfo] = useState(false);
  const [allDone, setAllDone] = useState(false);

  const groups: Record<HubSection, DiceGameDoc[]> = { move: [], wait: [], done: [] };
  for (const game of games) groups[sectionOf(game, uid)].push(game);
  const sections: HubSection[] = ["move", "wait", "done"];

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-background px-4 pb-24 pt-[max(env(safe-area-inset-top),1.25rem)]">
      <ScreenHeader
        title="Roll Dice"
        fallback="/lobby"
        right={
          <button
            type="button"
            onClick={() => setInfo(true)}
            aria-label="How to play and settings"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-bright hover:bg-white/10 hover:text-white"
          >
            <CircleHelp size={22} aria-hidden="true" />
          </button>
        }
      />

      <div className="mt-3 grid grid-cols-3 gap-2" data-testid="dice-record">
        <Tile label="Rep" value={fmt(stats.rep)} sub={`Peak ${fmt(stats.peakRep)}`} />
        <Tile label="Record" value={<RecordFigure wins={stats.wins} games={stats.gamesPlayed} />} sub="won" />
        <Tile label="Streak" value={String(stats.streak)} sub={`Best ${stats.bestStreak}`} />
      </div>

      <div className="mt-4">
        <Btn onClick={() => navigate("/dice/new")}>New match</Btn>
      </div>

      {loading ? (
        <div className="mt-6 space-y-2" aria-busy="true" aria-label="Loading matches" data-testid="dice-hub-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="mt-6 rounded-2xl border border-white/[0.06] bg-surface px-4 py-4">
          <p className="font-body text-sm text-white">Couldn't load your matches.</p>
          <button
            type="button"
            onClick={retry}
            className="mt-1 inline-flex min-h-11 items-center font-body text-sm text-brand-orange"
          >
            Try again
          </button>
        </div>
      ) : games.length === 0 ? (
        <div
          className="mt-6 rounded-2xl border border-dashed border-white/[0.12] px-4 py-6 text-center"
          data-testid="dice-hub-empty"
        >
          <p className="font-display text-xl tracking-wider text-white">No matches yet</p>
          <p className="mt-1 font-body text-sm text-bright">Pick a game, pick a skater, and send it.</p>
          <button
            type="button"
            onClick={() => setInfo(true)}
            className="mt-2 inline-flex min-h-11 items-center font-body text-sm text-brand-orange"
          >
            How the games work
          </button>
        </div>
      ) : (
        sections.map((section) => {
          const list = section === "done" && !allDone ? groups.done.slice(0, DONE_SHOWN) : groups[section];
          if (list.length === 0) return null;
          return (
            <section key={section} className="mt-6" aria-labelledby={`dice-${section}`}>
              <h2 id={`dice-${section}`} className="mb-2 font-display text-sm tracking-[0.18em] text-muted">
                {TITLES[section]} · {groups[section].length}
              </h2>
              <ul className="space-y-2">
                {list.map((game) => (
                  <li key={game.id}>
                    <MatchRow {...rowOf(game, uid, now)} onOpen={() => navigate(`/dice/${game.id}`)} />
                  </li>
                ))}
              </ul>
              {section === "done" && groups.done.length > DONE_SHOWN ? (
                <button
                  type="button"
                  onClick={() => setAllDone((v) => !v)}
                  className="mt-1 inline-flex min-h-11 items-center font-body text-sm text-brand-orange"
                >
                  {allDone ? "Show fewer" : `Show all ${groups.done.length}`}
                </button>
              ) : null}
            </section>
          );
        })
      )}

      {info ? <DiceInfoSheet onClose={() => setInfo(false)} /> : null}
    </div>
  );
}

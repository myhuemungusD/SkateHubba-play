import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CircleHelp } from "lucide-react";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ConfirmSheet } from "../../components/dice/ConfirmSheet";
import { DiceSpot } from "../../components/dice/DiceSpot";
import { MatchResult } from "../../components/dice/MatchResult";
import { RoundLog, handName } from "../../components/dice/RoundLog";
import { Scoreboard } from "../../components/dice/Scoreboard";
import { useReveal } from "../../components/dice/useReveal";
import { useDiceStats } from "../../hooks/useDice";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import {
  acceptDice,
  bankDice,
  claimDiceTimeout,
  declineDice,
  diceErrorCode,
  diceErrorMessage,
  nudgeDice,
  quitDice,
  rematchDice,
  rollDice,
  type DiceCallResult,
  type DiceGameDoc,
} from "../../services/dice";
import { isQuickRolls, playDiceCue } from "../../services/diceFeel";
import { DiceInfoSheet } from "./DiceInfoSheet";
import { needLine } from "./diceRules";
import { MODE_COPY, endReasonLine, endTitle, fmt, opponentName, opponentUid, targetLabel } from "./diceCopy";
import { TableDock, type TableAction } from "./TableDock";
import {
  cueFor,
  diceCount,
  localFromResult,
  rollAnnouncement,
  shownRoll,
  sideOf,
  tenPlan,
  type LocalRoll,
} from "./tableState";

type Sheet = "info" | "forfeit" | "decline" | null;

function useClock(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** One match at the ledge. `game` is always loaded here. */
export function TableView({ game, uid }: { game: DiceGameDoc; uid: string }) {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const reduced = useReducedMotion();
  const stats = useDiceStats(uid);
  const now = useClock(30_000);
  const [quick, setQuick] = useState(isQuickRolls);
  const [busy, setBusy] = useState<TableAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalRoll | null>(null);
  const [pick, setPick] = useState<{ rollId: string | null; keep: number[] }>({ rollId: null, keep: [] });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [announce, setAnnounce] = useState("");
  const claimed = useRef<string | null>(null);
  // State updates land a render late; a ref stops a double tap sending two moves.
  const inFlight = useRef(false);

  const name = opponentName(game.player1Uid, game.player1Username, game.player2Username, uid) || "skater";
  const them = opponentUid(game.player1Uid, game.player2Uid, uid);
  const roll = shownRoll(game, local);
  const rollKey = roll?.rollId ?? null;
  const finished = game.status !== "active" && game.status !== "pending";
  const mine = game.status === "active" && game.currentTurn === uid;
  const synced = roll === game.lastRoll;
  const choosing = mine && synced && game.mode === "ten" && game.ten.rolled.length > 0;
  const keep = choosing && pick.rollId === game.lastRoll?.rollId ? pick.keep : [];
  const plan = game.mode === "ten" && mine ? tenPlan(game, keep) : null;

  const { landing, skip } = useReveal(
    rollKey,
    roll?.dice.length ?? 0,
    quick || reduced,
    () => playDiceCue("land"),
    () => {
      if (!roll) return;
      setAnnounce(rollAnnouncement(game, roll, uid));
      if (finished && (game.status === "complete" || game.status === "forfeit"))
        playDiceCue(game.winner === uid ? "win" : "loss");
      else playDiceCue(cueFor(roll));
    },
  );

  useEffect(() => {
    if (!online || (game.status !== "active" && game.status !== "pending") || game.turnDeadline > now) return;
    const key = `${game.id}:${game.turnDeadline}`;
    if (claimed.current === key) return;
    claimed.current = key;
    // Losing the race to the other seat or the sweep is fine: the snapshot shows the result.
    void claimDiceTimeout(game.id).catch((err) => {
      if (diceErrorCode(err) !== "game_over") setError(diceErrorMessage(err));
    });
  }, [game.id, game.status, game.turnDeadline, now, online]);

  async function run(action: TableAction, call: () => Promise<DiceCallResult | void>): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setError(null);
    const base = game.lastRoll?.rollId ?? null;
    if (action === "roll") playDiceCue("throw");
    try {
      const result = await call();
      if (result && (action === "roll" || action === "bank")) setLocal(localFromResult(result, uid, base));
    } catch (err) {
      setError(diceErrorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function act(action: TableAction): void {
    switch (action) {
      case "accept":
        return void run(action, () => acceptDice(game.id));
      case "decline":
        return setSheet("decline");
      case "cancel":
        return void run(action, () => quitDice(game.id));
      case "roll":
        return void run(action, () => rollDice(game.id, keep));
      case "bank":
        return void run(action, () => bankDice(game.id, keep));
      case "nudge":
        return void run(action, () => nudgeDice(game.id));
      case "hub":
        return void navigate("/dice");
      case "rematch":
        if (game.rematchGameId) return void navigate(`/dice/${game.rematchGameId}`);
        return void run(action, async () => {
          const next = await rematchDice(game.id);
          navigate(`/dice/${next.gameId}`, { replace: true });
        });
    }
  }

  function toggle(index: number): void {
    const base = pick.rollId === game.lastRoll?.rollId ? pick.keep : [];
    const next = base.includes(index) ? base.filter((i) => i !== index) : [...base, index].sort();
    setPick({ rollId: game.lastRoll?.rollId ?? null, keep: next });
  }

  const copy = MODE_COPY[game.mode];
  const you = sideOf(game, uid, uid);
  const opp = sideOf(game, them, uid);
  const won = game.winner === uid;
  const played = game.status === "complete" || game.status === "forfeit";
  const repDelta = game.repChange?.[uid] ?? null;
  const caption = roll ? `${roll.uid === uid ? "You" : `@${name}`}: ${handName(roll.label)}` : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-background px-4 pt-[max(env(safe-area-inset-top),1.25rem)]">
      <ScreenHeader
        title={`vs @${name}`}
        fallback="/dice"
        right={
          <button
            type="button"
            onClick={() => setSheet("info")}
            aria-label="How to play and settings"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-bright hover:bg-white/10 hover:text-white"
          >
            <CircleHelp size={22} aria-hidden="true" />
          </button>
        }
      />
      <p className="mb-4 mt-0.5 font-display text-sm tracking-[0.16em] text-muted" data-testid="dice-meta">
        {copy.name} · {targetLabel(game.target)}
        {game.status === "active"
          ? ` · ${game.mode === "clo" || game.mode === "s456" ? "Round" : "Hand"} ${game.round}`
          : ""}
      </p>

      {finished ? (
        <div className="mb-4">
          <MatchResult
            title={endTitle(game, uid)}
            reason={endReasonLine(game.endReason, won, name)}
            score={played ? `${fmt(you.score)} – ${fmt(opp.score)}` : null}
            won={played && won}
            repDelta={repDelta}
            repAfter={repDelta !== null ? stats.rep : null}
          />
        </div>
      ) : null}

      <Scoreboard you={you} them={opp} target={game.target} />

      {game.status === "pending" ? (
        <p className="mt-3 font-body text-sm text-bright">
          {copy.tagline}{" "}
          <button
            type="button"
            onClick={() => setSheet("info")}
            className="text-brand-orange underline-offset-2 hover:underline"
          >
            How {copy.name} works
          </button>
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <RoundLog
        rounds={game.rounds}
        uid={uid}
        names={{ [game.player1Uid]: game.player1Username, [game.player2Uid]: game.player2Username }}
        unit={game.mode === "clo" || game.mode === "s456" ? "Round" : "Hand"}
      />

      {game.status === "active" ? (
        <button
          type="button"
          onClick={() => setSheet("forfeit")}
          className="mt-6 inline-flex min-h-11 items-center font-body text-sm text-muted hover:text-white"
        >
          Forfeit match
        </button>
      ) : null}

      {/* The dice and the move that throws them share the thumb zone: the tray
          sits right on the dock and the whole group sticks to the bottom of the
          screen, so the Roll button never covers the dice and the round log
          scrolls behind them. Capped at 75% of the screen so the scoreboard
          stays reachable on short or landscape screens; the tray scrolls on
          its own there. */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-auto flex max-h-[75dvh] flex-col pt-6" data-testid="dice-tray">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-t from-background to-transparent"
        />
        <div className="min-h-0 overflow-y-auto overscroll-contain bg-background px-4 pb-4">
          <DiceSpot
            dice={busy === "roll" ? null : choosing ? game.ten.rolled : (roll?.dice ?? null)}
            rollKey={rollKey ?? "none"}
            count={busy === "roll" && plan ? plan.nextCount : diceCount(game)}
            size={game.mode === "ten" ? "md" : "lg"}
            rolling={busy === "roll"}
            landing={landing}
            quick={quick || reduced}
            onSkip={skip}
            selection={
              choosing ? { selected: new Set(keep), live: plan?.live ?? new Set(), onToggle: toggle } : undefined
            }
            kept={game.mode === "ten" && mine ? game.ten.kept : undefined}
            point={game.mode === "craps" ? game.point : undefined}
          >
            {caption && !landing && busy !== "roll" ? (
              <p
                className="dice-fade text-center font-display text-lg tracking-wider text-white"
                data-testid="dice-caption"
              >
                {caption}
                {roll?.callout ? <span className="ml-2 text-brand-orange">· {roll.callout}</span> : null}
              </p>
            ) : null}
          </DiceSpot>
          {mine ? (
            <p className="mt-3 font-body text-sm text-bright" data-testid="dice-need">
              {needLine(game, uid)}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 font-body text-sm text-brand-red">
              {error}
            </p>
          ) : null}
        </div>
        <TableDock
          game={game}
          uid={uid}
          name={name}
          now={now}
          online={online}
          busy={busy}
          landing={landing || !synced}
          plan={plan}
          onAction={act}
        />
      </div>

      {sheet === "info" ? (
        <DiceInfoSheet
          mode={game.mode}
          onClose={() => {
            setQuick(isQuickRolls());
            setSheet(null);
          }}
        />
      ) : null}
      {sheet === "forfeit" ? (
        <ConfirmSheet
          title="Forfeit this match?"
          body={`It counts as a loss and @${name} takes the win. Your Rep drops.`}
          confirmLabel="Forfeit"
          onCancel={() => setSheet(null)}
          onConfirm={() => {
            setSheet(null);
            void run("cancel", () => quitDice(game.id));
          }}
        />
      ) : null}
      {sheet === "decline" ? (
        <ConfirmSheet
          title="Decline the challenge?"
          body={`@${name} gets told you passed. Nothing counts toward either record.`}
          confirmLabel="Decline"
          cancelLabel="Back"
          onCancel={() => setSheet(null)}
          onConfirm={() => {
            setSheet(null);
            void run("decline", () => declineDice(game.id));
          }}
        />
      ) : null}
    </div>
  );
}

import { ActionDock } from "../../components/ActionDock";
import { Btn } from "../../components/ui/Btn";
import type { DiceGameDoc } from "../../services/dice";
import { fmt, timeLeft } from "./diceCopy";
import type { TenPlan } from "./tableState";

export type TableAction = "accept" | "decline" | "cancel" | "roll" | "bank" | "nudge" | "rematch" | "hub";

const NUDGE_COOLDOWN_MS = 60 * 60 * 1000;

interface TableDockProps {
  game: DiceGameDoc;
  uid: string;
  name: string;
  now: number;
  online: boolean;
  busy: TableAction | null;
  /** Dice are still landing; the next move waits for them. */
  landing: boolean;
  plan: TenPlan | null;
  onAction: (action: TableAction) => void;
}

function TextButton({ children, onClick, disabled }: { children: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-1 inline-flex min-h-11 w-full items-center justify-center font-body text-sm text-bright hover:text-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Waiting({ line, clock }: { line: string; clock: string }) {
  return (
    <p className="mb-2 flex items-center justify-between font-body text-sm text-bright" data-testid="dice-waiting">
      <span>{line}</span>
      <span className="tabular-nums text-muted">{clock}</span>
    </p>
  );
}

function tenRollLabel(plan: TenPlan | null, game: DiceGameDoc): string {
  if (game.ten.rolled.length === 0) return game.ten.turnScore > 0 ? "Roll all six" : "Roll six dice";
  if (!plan || plan.keep.length === 0) return "Pick scoring dice";
  if (!plan.valid) return "Those dice don't score";
  return plan.nextCount === 6
    ? "Hot dice: roll all six"
    : `Roll ${plan.nextCount} ${plan.nextCount === 1 ? "die" : "dice"}`;
}

/** The bottom dock: always exactly the next thing you can do, and never a dead end. */
export function TableDock({ game, uid, name, now, online, busy, landing, plan, onAction }: TableDockProps) {
  const locked = busy !== null || !online;
  const clock = timeLeft(game.turnDeadline, now);
  let body;

  if (game.status === "pending") {
    body =
      game.player2Uid === uid ? (
        <>
          <Btn onClick={() => onAction("accept")} disabled={locked}>
            {busy === "accept" ? "Joining…" : "Accept challenge"}
          </Btn>
          <TextButton onClick={() => onAction("decline")} disabled={locked}>
            Decline
          </TextButton>
        </>
      ) : (
        <>
          <Waiting line={`Waiting for @${name} to accept`} clock={clock} />
          <TextButton onClick={() => onAction("cancel")} disabled={locked}>
            Call off challenge
          </TextButton>
        </>
      );
  } else if (game.status === "active" && game.currentTurn === uid) {
    if (game.mode === "ten" && game.ten.rolled.length > 0) {
      const ok = Boolean(plan?.valid);
      body = (
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="secondary" onClick={() => onAction("bank")} disabled={locked || landing || !ok}>
            {busy === "bank" ? "Banking…" : `Bank ${fmt(plan?.bankTotal ?? game.ten.turnScore)}`}
          </Btn>
          <Btn onClick={() => onAction("roll")} disabled={locked || landing || !ok}>
            {busy === "roll" ? "Rolling…" : tenRollLabel(plan, game)}
          </Btn>
        </div>
      );
    } else {
      body = (
        <Btn onClick={() => onAction("roll")} disabled={locked || landing}>
          {busy === "roll" ? "Rolling…" : game.mode === "ten" ? tenRollLabel(plan, game) : "Roll"}
        </Btn>
      );
    }
  } else if (game.status === "active") {
    const nudged = game.nudgedAt !== null && now - game.nudgedAt < NUDGE_COOLDOWN_MS;
    body = (
      <>
        <Waiting line={`@${name} is up`} clock={clock} />
        <Btn variant="ghost" haptic={false} onClick={() => onAction("nudge")} disabled={locked || nudged}>
          {nudged ? "Nudged" : busy === "nudge" ? "Nudging…" : `Nudge @${name}`}
        </Btn>
      </>
    );
  } else {
    const played = game.status === "complete" || game.status === "forfeit";
    body = (
      <>
        <Btn onClick={() => onAction("rematch")} disabled={locked}>
          {game.rematchGameId
            ? "Open rematch"
            : busy === "rematch"
              ? "Sending…"
              : played
                ? "Rematch"
                : "Challenge again"}
        </Btn>
        <TextButton onClick={() => onAction("hub")}>Back to Roll Dice</TextButton>
      </>
    );
  }

  return (
    <ActionDock testId="dice-actions">
      {!online ? (
        <p role="status" className="mb-2 text-center font-body text-xs text-brand-orange">
          You're offline. Moves unlock when you reconnect.
        </p>
      ) : null}
      {body}
    </ActionDock>
  );
}

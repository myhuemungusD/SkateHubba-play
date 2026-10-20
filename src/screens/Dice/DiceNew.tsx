import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { CircleHelp } from "lucide-react";
import { ActionDock } from "../../components/ActionDock";
import { OpponentPicker } from "../../components/OpponentPicker";
import { ScreenHeader } from "../../components/ScreenHeader";
import { Btn } from "../../components/ui/Btn";
import { Die } from "../../components/dice/Die";
import { useAuthContext } from "../../context/AuthContext";
import {
  DICE_MODES,
  DICE_TARGETS,
  createCooldownLine,
  createDiceGame,
  diceErrorInfo,
  diceErrorMessage,
  type DiceMode,
} from "../../services/dice";
import { getUidByUsername } from "../../services/users";
import { DiceInfoSheet } from "./DiceInfoSheet";
import { MODE_COPY, fmt } from "./diceCopy";

/** Sample faces for each game's card: its signature hand. */
const SAMPLE: Readonly<Record<DiceMode, number[]>> = {
  clo: [4, 5, 6],
  s456: [6, 6, 6],
  craps: [5, 6],
  ten: [1, 1, 1, 5],
};

interface Preset {
  uid: string;
  username: string;
}

function presetFrom(state: unknown): Preset | null {
  const opp = (state as { opponent?: Partial<Preset> } | null)?.opponent;
  return opp && typeof opp.uid === "string" && typeof opp.username === "string"
    ? { uid: opp.uid, username: opp.username }
    : null;
}

/** /dice/new — choose a game and a length, then who you're rolling. */
export function DiceNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthContext();
  const preset = presetFrom(location.state);
  const [mode, setMode] = useState<DiceMode>("clo");
  const [target, setTarget] = useState<number>(DICE_TARGETS.clo[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(false);
  // When the server's create cooldown is running: the time it ends, and the clock that counts it down.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const waitMs = retryAt === null ? 0 : retryAt - now;

  useEffect(() => {
    if (retryAt === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= retryAt) setRetryAt(null);
    }, 250);
    return () => clearInterval(id);
  }, [retryAt]);

  function chooseMode(next: DiceMode): void {
    setMode(next);
    setTarget(DICE_TARGETS[next][0]);
  }

  async function send(opponent: { uid?: string; username: string }): Promise<void> {
    if (!user || busy || retryAt !== null) return;
    setBusy(true);
    setError(null);
    try {
      const uid = opponent.uid ?? (await getUidByUsername(opponent.username));
      if (!uid) {
        setError("No skater with that name.");
        return;
      }
      const result = await createDiceGame(uid, mode, target);
      navigate(`/dice/${result.gameId}`, { replace: true });
    } catch (err) {
      const { code, retryAfterMs } = diceErrorInfo(err);
      if (code === "create_cooldown" && retryAfterMs !== null) {
        setNow(Date.now());
        setRetryAt(Date.now() + retryAfterMs);
      } else setError(diceErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] bg-background px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-[max(env(safe-area-inset-top),1.25rem)]">
      <ScreenHeader
        title={preset ? `Roll @${preset.username}` : "New match"}
        fallback="/dice"
        right={
          <button
            type="button"
            onClick={() => setInfo(true)}
            aria-label="How to play"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-bright hover:bg-white/10 hover:text-white"
          >
            <CircleHelp size={22} aria-hidden="true" />
          </button>
        }
      />

      <fieldset className="mt-4">
        <legend className="mb-2 font-display text-sm tracking-[0.18em] text-muted">Game</legend>
        <div className="grid grid-cols-2 gap-2">
          {DICE_MODES.map((m) => {
            const on = m === mode;
            return (
              <label
                key={m}
                className={`relative flex min-h-[112px] cursor-pointer flex-col justify-between rounded-2xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-orange ${on ? "border-brand-orange/70 bg-brand-orange/[0.07]" : "border-white/[0.07] bg-surface hover:border-white/20"}`}
              >
                <input
                  type="radio"
                  name="dice-mode"
                  value={m}
                  checked={on}
                  onChange={() => chooseMode(m)}
                  className="sr-only"
                />
                <span className="flex gap-1" aria-hidden="true">
                  {SAMPLE[m].map((face, i) => (
                    <Die key={i} face={face} size="xs" order={i} />
                  ))}
                </span>
                <span>
                  <span className="block font-display text-xl tracking-wider text-white">{MODE_COPY[m].name}</span>
                  <span className="block font-body text-xs leading-snug text-bright">{MODE_COPY[m].tagline}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="mb-2 font-display text-sm tracking-[0.18em] text-muted">Length</legend>
        <div className="flex gap-2">
          {DICE_TARGETS[mode].map((t, i) => {
            const on = t === target;
            return (
              <label
                key={t}
                className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border px-3 font-body text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-orange ${on ? "border-white bg-white text-[#111]" : "border-white/[0.1] text-white"}`}
              >
                <input
                  type="radio"
                  name="dice-target"
                  value={t}
                  checked={on}
                  onChange={() => setTarget(t)}
                  className="sr-only"
                />
                {i === 0 ? "Short" : "Long"} · first to {fmt(t)}
              </label>
            );
          })}
        </div>
      </fieldset>

      <section className="mt-6">
        <h2 className="mb-2 font-display text-sm tracking-[0.18em] text-muted">
          {preset ? "Opponent" : "Who are you rolling?"}
        </h2>
        {!user ? (
          <p className="font-body text-sm text-muted">Sign in to roll.</p>
        ) : preset ? (
          <p className="rounded-2xl border border-white/[0.07] bg-surface px-4 py-3 font-body text-sm text-white">
            @{preset.username}
          </p>
        ) : (
          <OpponentPicker viewerUid={user.uid} collapsed={busy} onSelect={(username) => void send({ username })} />
        )}
      </section>

      {retryAt !== null ? (
        <p role="status" className="mt-4 font-body text-sm text-bright" data-testid="dice-new-cooldown">
          {createCooldownLine(waitMs)}
        </p>
      ) : error ? (
        <p role="alert" className="mt-4 font-body text-sm text-brand-red">
          {error}
        </p>
      ) : null}

      {preset && user ? (
        <ActionDock testId="dice-new-actions">
          <Btn onClick={() => void send(preset)} disabled={busy || retryAt !== null}>
            {busy ? "Sending…" : "Send challenge"}
          </Btn>
        </ActionDock>
      ) : null}

      {info ? <DiceInfoSheet mode={mode} onClose={() => setInfo(false)} /> : null}
    </div>
  );
}

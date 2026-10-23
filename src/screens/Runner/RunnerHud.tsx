import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import { LOW_RAIL_CREDIT, SKATEBOARD_01_CREDIT, SKATEPARK_CREDIT } from "../../runner/boardCredit";
import { ARM_LABELS } from "../../runner/constants";
import type { HudSnapshot } from "../../runner/controller";
import type { Grade } from "../../runner/types";

const GRADE_LABEL: Record<Grade, string> = {
  perfect: "PERFECT",
  clean: "CLEAN",
  sketchy: "SKETCHY",
};

const LEAN_CLASS = [
  "-translate-x-12",
  "-translate-x-9",
  "-translate-x-6",
  "-translate-x-3",
  "translate-x-0",
  "translate-x-3",
  "translate-x-6",
  "translate-x-9",
  "translate-x-12",
] as const;

function leanClass(balance: number): string {
  const clamped = Math.max(-1, Math.min(1, balance));
  const index = Math.round((clamped + 1) * 4);
  return LEAN_CLASS[index] ?? "translate-x-0";
}

interface Props {
  hud: HudSnapshot;
  fpsRef: RefObject<HTMLElement | null>;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  sensitivity: number;
  onToggleControl: () => void;
  onSensitivity: (value: number) => void;
  assist: number;
  feelLabel: string;
  onAssist: (value: number) => void;
  onCycleFeel: () => void;
}

const BTN =
  "min-h-11 rounded-xl px-4 font-display tracking-wider focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2c14a]";
const CHUNK = "[text-shadow:0_3px_0_#143028]";

function comboLabel(multiplier: number): string {
  return Number.isInteger(multiplier) ? `x${multiplier}` : `x${multiplier.toFixed(1)}`;
}

function CreditParagraph({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <p className="font-body text-[11px] leading-snug text-white/50">
      {parts.map((part, index) =>
        part.startsWith("http") ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-white/30 underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2c14a]"
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}

export function RunnerHud({
  hud,
  fpsRef,
  onPause,
  onResume,
  onRestart,
  sensitivity,
  onToggleControl,
  onSensitivity,
  assist,
  feelLabel,
  onAssist,
  onCycleFeel,
}: Props) {
  const restartRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (hud.status === "gameover") restartRef.current?.focus();
    if (hud.status === "paused" && hud.distance === 0) playRef.current?.focus();
  }, [hud.status, hud.distance]);

  const resumeLabel = hud.distance === 0 ? "Play" : "Resume";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col px-10 pt-[max(env(safe-area-inset-top),0.75rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-sm tracking-[0.35em] text-[#f2c14a]">Skate Runner</h1>
          <p data-testid="runner-score" className={`font-display text-5xl leading-none text-[#f6e7b0] ${CHUNK}`}>
            <span className="sr-only">Score </span>
            {hud.score}
          </p>
          <p className="font-body text-xs text-white/60">{hud.distance} m</p>
          {hud.combo >= 2 ? (
            <p className="font-display text-sm tracking-widest text-[#f2c14a]">
              {hud.combo} STREAK <span>{comboLabel(hud.multiplier)}</span>
            </p>
          ) : null}
          {hud.best > 0 && hud.status !== "gameover" ? (
            <p data-testid="runner-best" className="font-body text-[11px] tracking-wider text-white/50">
              Best {hud.best}
            </p>
          ) : null}
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <p className="font-body text-[11px] tracking-wider text-white/50" aria-hidden>
            FPS <span ref={fpsRef}>—</span>
          </p>
          {hud.status === "playing" ? (
            <button type="button" className={`${BTN} bg-white/10 text-white`} onClick={onPause}>
              Pause
            </button>
          ) : null}
          <Link to="/" className={`${BTN} inline-flex items-center bg-transparent text-sm text-white/80`}>
            Exit
          </Link>
        </div>
      </div>

      <p className="sr-only" id="runner-help">
        Three lanes. Swipe left or right to change lanes. Tap for a crooked grind, tap twice for a nose slide, swipe up
        to kickflip into the grind. On a grind, swipe or hold left and right to keep your balance, and tap to pop off.
        Swipe down to powerslide. The score stays on this run. This device remembers the best line.
      </p>
      <p className="sr-only" aria-live="polite" data-testid="runner-announce">
        {hud.announce}
      </p>

      {hud.trickName ? (
        <div className="pointer-events-none absolute left-1/2 top-[28%] flex -translate-x-1/2 flex-col items-center">
          <p aria-hidden className={`font-display text-4xl tracking-[0.08em] text-[#f2c14a] sm:text-5xl ${CHUNK}`}>
            {hud.trickName}
          </p>
          {hud.grade ? (
            <p
              aria-hidden
              className="font-display text-lg tracking-[0.28em] text-[#d5e7c8] [text-shadow:0_2px_0_#143028]"
            >
              {GRADE_LABEL[hud.grade]}
            </p>
          ) : null}
          {hud.popup > 0 ? (
            <p
              aria-hidden
              data-testid="runner-popup"
              className={`font-display text-3xl tracking-wide text-[#f6e27a] ${CHUNK}`}
            >
              +{hud.popup}
            </p>
          ) : null}
        </div>
      ) : hud.armed ? (
        <p
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 font-display text-2xl tracking-[0.2em] text-white/80"
        >
          {ARM_LABELS[hud.armed]}
        </p>
      ) : null}

      {hud.showHint ? (
        <p className="pointer-events-none mt-6 text-center font-body text-sm text-white/80">
          Tap a crooked grind. Double-tap nose. Swipe up flips in.
        </p>
      ) : null}

      {hud.onGrind ? (
        <div className="mt-auto flex flex-col items-center pb-1" data-testid="runner-balance">
          <p className="font-body text-[11px] tracking-[0.28em] text-white/70">BALANCE</p>
          <div className="relative mt-1 h-2 w-28 overflow-hidden rounded-full bg-white/15">
            <span
              className={`absolute top-0 left-1/2 h-2 w-2 -ml-1 rounded-full ${leanClass(hud.balance)} ${
                Math.abs(hud.balance) > 0.72 ? "bg-red-400" : "bg-[#f2c14a]"
              }`}
            />
          </div>
        </div>
      ) : (
        <div className="mt-auto" />
      )}

      <div className="flex justify-center gap-2 pb-2" aria-hidden>
        {[0, 1, 2].map((lane) => (
          <span key={lane} className={`h-2 w-6 rounded-full ${lane === hud.lane ? "bg-[#f2c14a]" : "bg-white/25"}`} />
        ))}
      </div>

      {hud.status === "paused" ? (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55 px-8">
          <div className="w-full max-w-xs rounded-2xl bg-[#1c1c1c] px-6 py-6 text-center">
            <h2 className="font-display text-3xl tracking-wide text-white">
              {hud.distance === 0 ? "Skate Runner" : "Paused"}
            </h2>
            <p className="mt-2 font-body text-sm text-white/70">
              {hud.distance === 0
                ? "Pick a lane. Tap the grind. Double-tap for nose. Swipe up to flip in."
                : "The street is frozen."}
            </p>
            <button
              ref={playRef}
              type="button"
              className={`${BTN} mt-5 w-full bg-[#f2c14a] text-[#143028]`}
              onClick={onResume}
            >
              {resumeLabel}
            </button>
            <button
              type="button"
              data-testid="runner-control-mode"
              className={`${BTN} mt-2 w-full bg-white/10 text-white`}
              onClick={onToggleControl}
            >
              {hud.streamlined ? "Easy flicks" : "Classic tricks"}
            </button>
            <button
              type="button"
              data-testid="runner-feel"
              className={`${BTN} mt-2 w-full bg-white/10 text-white`}
              onClick={onCycleFeel}
            >
              Feel {feelLabel}
            </button>
            <label className="mt-3 block text-left font-body text-xs text-white/60">
              Grind assist {assist}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={assist}
                aria-label="Grind assist"
                className="mt-1 w-full accent-[#f2c14a]"
                onChange={(event) => onAssist(Number(event.target.value))}
              />
            </label>
            <label className="mt-3 block text-left font-body text-xs text-white/60">
              Flick sensitivity {sensitivity}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sensitivity}
                aria-label="Flick sensitivity"
                className="mt-1 w-full accent-[#f2c14a]"
                onChange={(event) => onSensitivity(Number(event.target.value))}
              />
            </label>
            <div data-testid="runner-credit" className="mt-4 max-h-40 space-y-2 overflow-y-auto text-left">
              <CreditParagraph text={SKATEBOARD_01_CREDIT} />
              <CreditParagraph text={LOW_RAIL_CREDIT} />
              <CreditParagraph text={SKATEPARK_CREDIT} />
            </div>
          </div>
        </div>
      ) : null}

      {hud.status === "gameover" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="runner-over-title"
          className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/70 px-8"
        >
          <div className="w-full max-w-xs rounded-2xl bg-[#1c1c1c] px-6 py-6 text-center">
            <h2 id="runner-over-title" className="font-display text-4xl tracking-wide text-white">
              Game over
            </h2>
            <p className={`mt-2 font-display text-3xl text-[#f2c14a] ${CHUNK}`}>{hud.score}</p>
            <p className="font-body text-xs text-white/60">{hud.distance} m this run</p>
            {hud.isNewBest ? (
              <p data-testid="runner-best" className="mt-1 font-display tracking-widest text-[#f2c14a]">
                New best
              </p>
            ) : hud.best > 0 ? (
              <p data-testid="runner-best" className="mt-1 font-body text-xs text-white/50">
                Best {hud.best}
              </p>
            ) : null}
            <button
              ref={restartRef}
              type="button"
              className={`${BTN} mt-5 w-full bg-[#f2c14a] text-[#143028]`}
              onClick={onRestart}
            >
              Play again
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

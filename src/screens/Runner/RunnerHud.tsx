import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import { LOW_RAIL_CREDIT, SKATEBOARD_01_CREDIT } from "../../runner/boardCredit";
import { ARM_LABELS } from "../../runner/constants";
import type { HudSnapshot } from "../../runner/controller";
import type { Grade } from "../../runner/types";

const GRADE_LABEL: Record<Grade, string> = {
  perfect: "PERFECT",
  good: "GOOD",
  sloppy: "SLOPPY",
};

interface Props {
  hud: HudSnapshot;
  fpsRef: RefObject<HTMLElement | null>;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
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
    <p className="font-body text-[10px] leading-snug text-white/50">
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

export function RunnerHud({ hud, fpsRef, onPause, onResume, onRestart }: Props) {
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
            <p className="font-display text-sm tracking-widest text-[#f2c14a]">{comboLabel(hud.multiplier)}</p>
          ) : null}
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <p className="font-body text-[10px] tracking-wider text-white/50" aria-hidden>
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
        to kickflip into the grind. Swipe down to powerslide. The score is only for this run.
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

      <div className="mt-auto flex justify-center gap-2 pb-2" aria-hidden>
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
            <div data-testid="runner-credit" className="mt-4 space-y-2 text-left">
              <CreditParagraph text={SKATEBOARD_01_CREDIT} />
              <CreditParagraph text={LOW_RAIL_CREDIT} />
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

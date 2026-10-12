import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import type { HudSnapshot } from "../../runner/controller";

interface Props {
  hud: HudSnapshot;
  fpsRef: RefObject<HTMLElement | null>;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
}

const BTN =
  "min-h-11 rounded-xl px-4 font-display tracking-wider focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

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
          <h1 className="font-display text-sm tracking-[0.35em] text-brand-orange">Skate Runner</h1>
          <p data-testid="runner-score" className="font-display text-4xl leading-none text-white">
            <span className="sr-only">Score </span>
            {hud.score}
          </p>
          <p className="font-body text-xs text-white/60">{hud.distance} m</p>
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
          <Link
            to="/"
            className={`${BTN} inline-flex items-center bg-transparent text-sm text-white/80`}
          >
            Exit
          </Link>
        </div>
      </div>

      <p className="sr-only" id="runner-help">
        Three lanes. Swipe left or right to change lanes, swipe up to ollie, swipe down to powerslide under a bar.
        Arrow keys do the same on a keyboard. The score is only for this run. It is not part of S.K.A.T.E.
      </p>
      <p className="sr-only" aria-live="polite" data-testid="runner-announce">
        {hud.announce}
      </p>

      {hud.trickName ? (
        <p
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[32%] -translate-x-1/2 font-display text-5xl tracking-[0.2em] text-brand-orange"
        >
          {hud.trickName}
        </p>
      ) : null}

      {hud.showHint ? (
        <p className="pointer-events-none mt-6 text-center font-body text-sm text-white/80">
          Swipe or arrow keys. Up ollies. Down ducks.
        </p>
      ) : null}

      <div className="mt-auto flex justify-center gap-2 pb-2" aria-hidden>
        {[0, 1, 2].map((lane) => (
          <span
            key={lane}
            className={`h-2 w-6 rounded-full ${lane === hud.lane ? "bg-brand-orange" : "bg-white/25"}`}
          />
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
                ? "Ollie the cones. Duck the bars. Lock the rail for a boardslide."
                : "The street is frozen."}
            </p>
            <button
              ref={playRef}
              type="button"
              className={`${BTN} mt-5 w-full bg-brand-orange text-[#1a1a1a]`}
              onClick={onResume}
            >
              {resumeLabel}
            </button>
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
            <p className="mt-2 font-display text-3xl text-brand-orange">{hud.score}</p>
            <p className="font-body text-xs text-white/60">{hud.distance} m this run</p>
            <button
              ref={restartRef}
              type="button"
              className={`${BTN} mt-5 w-full bg-brand-orange text-[#1a1a1a]`}
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

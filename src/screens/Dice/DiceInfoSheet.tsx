import { useRef, useState } from "react";
import { useSheetFocusTrap } from "../../components/useSheetFocusTrap";
import { DICE_MODES, type DiceMode } from "../../services/dice";
import { MODE_COPY } from "./diceCopy";
import { isHapticsEnabled, setHapticsEnabled } from "../../services/haptics";
import { isSoundEnabled, setSoundEnabled } from "../../services/sounds";
import { isQuickRolls, setQuickRolls } from "../../services/diceFeel";

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block font-body text-sm text-white">{label}</span>
        <span className="block font-body text-xs text-muted">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-white/15 transition-colors before:block before:h-5 before:w-5 before:translate-x-0.5 before:rounded-full before:bg-white before:transition-transform checked:bg-brand-orange checked:before:translate-x-[18px]"
      />
    </label>
  );
}

/** How to play every game, how points and Rep work, and the table settings. */
export function DiceInfoSheet({ mode, onClose }: { mode?: DiceMode; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useSheetFocusTrap(panelRef, onClose);
  const [tab, setTab] = useState<DiceMode>(mode ?? "clo");
  const [sound, setSound] = useState(isSoundEnabled);
  const [haptics, setHaptics] = useState(isHapticsEnabled);
  const [quick, setQuick] = useState(isQuickRolls);
  const copy = MODE_COPY[tab];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dice-info-title"
      onClick={onClose}
      data-testid="dice-info"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#121212] px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="dice-info-title" className="font-display text-2xl tracking-wider text-white">
            How to play
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 font-body text-sm text-muted hover:text-white"
          >
            Done
          </button>
        </div>

        <div role="tablist" aria-label="Game" className="grid grid-cols-4 gap-1 rounded-xl bg-white/[0.05] p-1">
          {DICE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={tab === m}
              onClick={() => setTab(m)}
              className={`min-h-10 rounded-lg font-display text-sm tracking-wider ${tab === m ? "bg-white text-[#111]" : "text-bright"}`}
            >
              {MODE_COPY[m].name}
            </button>
          ))}
        </div>

        <section role="tabpanel" aria-label={copy.name} className="mt-4">
          <p className="font-body text-sm text-bright">
            {copy.dice} dice · {copy.tagline}
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 font-body text-sm text-white/90 marker:text-muted">
            {copy.howTo.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <h3 className="mt-4 font-display text-sm tracking-[0.18em] text-muted">Points</h3>
          <ul className="mt-1.5 space-y-1 font-body text-sm text-white/90">
            {copy.points.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-brand-orange">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5 space-y-2 border-t border-white/[0.06] pt-4 font-body text-sm text-bright">
          <p>
            <span className="text-white">Matches are races.</span> First to the target score wins. Points only decide
            the match. There is nothing to bet, buy or cash in.
          </p>
          <p>
            <span className="text-white">Rep</span> is your skill rating. Everyone starts at 1,000. It moves after every
            decided match, and more when you beat someone rated above you.
          </p>
          <p>
            <span className="text-white">Fair rolls.</span> The server rolls every die with a secure random generator
            and scores every hand. The app can't pick or change a roll.
          </p>
          <p>
            <span className="text-white">Turns</span> last 24 hours. You get a reminder near the end. Run out and the
            match goes to the other skater.
          </p>
        </section>

        <section className="mt-5 border-t border-white/[0.06] pt-3">
          <h3 className="font-display text-sm tracking-[0.18em] text-muted">Table settings</h3>
          <Toggle
            label="Sound"
            hint="Dice on concrete, result chimes"
            on={sound}
            onChange={(v) => {
              setSoundEnabled(v);
              setSound(v);
            }}
          />
          <Toggle
            label="Haptics"
            hint="A tap on landing and big results"
            on={haptics}
            onChange={(v) => {
              setHapticsEnabled(v);
              setHaptics(v);
            }}
          />
          <Toggle
            label="Quick rolls"
            hint="Dice appear at once, no flight"
            on={quick}
            onChange={(v) => {
              setQuickRolls(v);
              setQuick(v);
            }}
          />
        </section>
      </div>
    </div>
  );
}

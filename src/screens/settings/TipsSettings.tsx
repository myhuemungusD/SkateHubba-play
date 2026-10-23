import { useState } from "react";
import { useTipsContext } from "../../context/TipsContext";
import { PrefRow } from "./SettingsPrimitives";

/** "Show tips" switch + "Replay tips". Renders nothing when the tips flag is off. */
export function TipsSettings() {
  const { available, disabled, setDisabled, replay } = useTipsContext();
  const [replayed, setReplayed] = useState(false);
  if (!available) return null;
  return (
    <div className="space-y-2" data-tutorial="tips-settings">
      <PrefRow
        title="Show tips"
        description="Hesher pops up the first time you open a screen to show you around."
        checked={!disabled}
        onChange={(on) => setDisabled(!on)}
      />
      <button
        type="button"
        onClick={() => {
          setReplayed(true);
          void replay();
        }}
        className="block w-full text-left p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        <p className="font-display text-sm text-white tracking-wide">Replay tips</p>
        <p className="font-body text-xs text-faint mt-1" aria-live="polite">
          {replayed ? "Done. Tips will show again on each screen." : "See every screen's tips again."}
        </p>
      </button>
    </div>
  );
}

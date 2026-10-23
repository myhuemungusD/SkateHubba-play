import type { SpotVisibility } from "../../services/mapCheckins";

interface Props {
  visibility: SpotVisibility;
  onChange: (v: SpotVisibility) => void;
  crewText: string;
  onCrewText: (v: string) => void;
}

const OPTIONS: ReadonlyArray<{ value: SpotVisibility; label: string; hint: string }> = [
  { value: "public", label: "Public", hint: "Everyone can see it on the map." },
  { value: "crew", label: "Crew only", hint: "Only you and the skaters you add." },
  { value: "private", label: "Only me", hint: "Nobody else ever sees it." },
];

/**
 * Who can see a new spot. Crew-only and private spots never show on the
 * public map, so a secret spot can't get blown up.
 */
export function SpotVisibilityPicker({ visibility, onChange, crewText, onCrewText }: Props) {
  const hint = OPTIONS.find((o) => o.value === visibility)?.hint;
  return (
    <fieldset className="mb-4" data-testid="spot-visibility">
      <legend className="text-xs font-semibold text-soft mb-1.5">Who can see this spot?</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={visibility === o.value}
            onClick={() => onChange(o.value)}
            className={`py-2 rounded-lg text-xs font-semibold border ${
              visibility === o.value ? "border-brand-orange text-brand-orange" : "border-line-strong text-soft"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-label text-subtle">{hint}</p>
      {visibility === "crew" && (
        <input
          type="text"
          value={crewText}
          onChange={(e) => onCrewText(e.target.value)}
          placeholder="Crew usernames, separated by commas"
          aria-label="Crew usernames"
          className="mt-2 w-full rounded-lg bg-surface-alt border border-line-strong px-3 py-2 text-sm text-white"
        />
      )}
    </fieldset>
  );
}

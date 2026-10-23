import type { ProfileCustom, SectionId } from "../../../../services/profileCustom";

export const SECTION_LABELS: Record<SectionId, string> = {
  clips: "Pinned clips",
  stats: "Stats",
  closet: "Closet showcase",
  crew: "Crew",
  spots: "Spots",
};

const SWATCHES = ["#FF6B00", "#FF2D55", "#AF52DE", "#0A84FF", "#30D158", "#FFD60A", "#FFFFFF", "#1A1A1A"];

export const input =
  "w-full min-h-[40px] rounded-lg border border-white/10 bg-black/40 px-3 font-body text-sm text-white placeholder:text-white/40";
export const label = "block mb-1 font-display text-[11px] tracking-[0.18em] text-white/60";

/** Shared props for each customize tab: the draft and a typed field setter. */
export interface TabProps {
  draft: ProfileCustom;
  set: <K extends keyof ProfileCustom>(k: K, v: ProfileCustom[K]) => void;
}

export function ColorRow({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <span className={label}>{name}</span>
      <div className="flex flex-wrap items-center gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${name} ${c}`}
            aria-pressed={value.toUpperCase() === c}
            onClick={() => onChange(c)}
            className={`h-8 w-8 rounded-full border ${value.toUpperCase() === c ? "border-white ring-2 ring-white/60" : "border-white/20"}`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          aria-label={`${name} custom color`}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
        />
      </div>
    </div>
  );
}

export function Slider(props: {
  name: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-3 block">
      <span className={label}>
        {props.name} · {props.value}
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-brand-orange"
      />
    </label>
  );
}

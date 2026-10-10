import { useMemo, useState } from "react";
import {
  OTHER_TRICK_ID,
  STANCE_LABELS,
  TRICK_NAME_MAX,
  TRICK_OBSTACLES,
  TRICK_STANCES,
  buildTrickPickerRows,
  formatTrickDisplayName,
  readRecentTrickIds,
  type TrickObstacle,
  type TrickSelection,
  type TrickStance,
  OBSTACLE_LABELS,
} from "../constants/tricks";
import { CUSTOM_CATEGORY_ID, trickCategoryHeadline, type TrickCategoryId } from "../constants/trickCategories";

interface Props {
  selection: TrickSelection | null;
  onChange: (selection: TrickSelection | null) => void;
  disabled: boolean;
  trickCategory?: TrickCategoryId;
  customRules?: string | null;
}

const chip =
  "min-h-11 px-3 rounded-full border font-body text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

/**
 * Searchable trick catalog. Recent and popular tricks lead so a phone
 * user can set a kickflip without scrolling the whole list.
 */
export function TrickPicker({ selection, onChange, disabled, trickCategory, customRules }: Props) {
  const headline = trickCategoryHeadline(trickCategory, customRules);
  const constraintText = headline && (trickCategory === CUSTOM_CATEGORY_ID ? headline : `${headline} only`);
  const [query, setQuery] = useState("");
  const [stance, setStance] = useState<TrickStance>(selection?.stance ?? "regular");
  const [obstacle, setObstacle] = useState<TrickObstacle | null>(selection?.obstacle ?? null);
  const [custom, setCustom] = useState(selection?.trickNameCustom ?? "");
  const [recentIds] = useState(() => readRecentTrickIds());
  const [otherOpen, setOtherOpen] = useState(selection?.trickId === OTHER_TRICK_ID);
  const rows = useMemo(() => buildTrickPickerRows(query, recentIds), [query, recentIds]);

  function emit(next: TrickSelection | null) {
    onChange(next);
  }

  function choose(
    trickId: string,
    trickNameCustom: string | null,
    nextStance: TrickStance = stance,
    nextObstacle: TrickObstacle | null = obstacle,
  ) {
    setOtherOpen(trickId === OTHER_TRICK_ID);
    const next: TrickSelection = {
      trickId,
      stance: nextStance,
      obstacle: nextObstacle,
      trickNameCustom,
    };
    if (!formatTrickDisplayName(next)) {
      emit(null);
      return;
    }
    emit(next);
  }

  return (
    <div className="mb-5 rounded-2xl border bg-brand-orange/[0.06] border-brand-orange/30 shadow-[0_0_20px_rgba(255,107,0,0.06)] p-3">
      <p className="font-display text-[11px] tracking-[0.2em] text-brand-orange text-center">TRICK</p>
      {constraintText && <p className="font-body text-xs text-brand-orange/80 pt-1 text-center">{constraintText}</p>}
      <div className="mt-2 grid grid-cols-4 gap-1" role="group" aria-label="Stance">
        {TRICK_STANCES.map((item) => (
          <button
            key={item}
            type="button"
            disabled={disabled}
            aria-pressed={stance === item}
            onClick={() => {
              setStance(item);
              if (selection) {
                choose(selection.trickId, selection.trickId === OTHER_TRICK_ID ? custom : null, item, obstacle);
              }
            }}
            className={`${chip} ${stance === item ? "bg-brand-orange/25 border-brand-orange text-white" : "border-border text-faint"}`}
          >
            {STANCE_LABELS[item]}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Obstacle">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={obstacle === null}
          onClick={() => {
            setObstacle(null);
            if (selection) choose(selection.trickId, selection.trickNameCustom, stance, null);
          }}
          className={`${chip} shrink-0 ${obstacle === null ? "bg-brand-orange/25 border-brand-orange text-white" : "border-border text-faint"}`}
        >
          Any
        </button>
        {TRICK_OBSTACLES.map((item) => (
          <button
            key={item}
            type="button"
            disabled={disabled}
            aria-pressed={obstacle === item}
            onClick={() => {
              setObstacle(item);
              if (selection) choose(selection.trickId, selection.trickNameCustom, stance, item);
            }}
            className={`${chip} shrink-0 ${obstacle === item ? "bg-brand-orange/25 border-brand-orange text-white" : "border-border text-faint"}`}
          >
            {OBSTACLE_LABELS[item]}
          </button>
        ))}
      </div>
      <label htmlFor="trickSearch" className="sr-only">
        Search tricks
      </label>
      <input
        id="trickSearch"
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search tricks"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="mt-2 min-h-11 w-full rounded-xl border border-border bg-transparent px-3 font-body text-base text-white outline-none placeholder:text-faint"
      />
      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border" role="listbox" aria-label="Tricks">
        {rows.length === 0 && <p className="px-3 py-4 font-body text-sm text-faint">No tricks match that.</p>}
        {rows.map((row) =>
          row.kind === "header" ? (
            <p key={row.id} className="px-3 pt-3 pb-1 font-display text-[10px] tracking-[0.16em] text-brand-orange">
              {row.label}
            </p>
          ) : (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={selection?.trickId === row.trick?.id}
              disabled={disabled}
              onClick={() => row.trick && choose(row.trick.id, null)}
              className={`flex min-h-11 w-full items-center px-3 text-left font-body text-sm ${
                selection?.trickId === row.trick?.id ? "bg-brand-orange/20 text-white" : "text-white/90"
              }`}
            >
              {row.label}
            </button>
          ),
        )}
        <button
          type="button"
          role="option"
          aria-selected={otherOpen}
          disabled={disabled}
          onClick={() => choose(OTHER_TRICK_ID, custom)}
          className={`flex min-h-11 w-full items-center px-3 text-left font-body text-sm border-t border-border ${
            otherOpen ? "bg-brand-orange/20 text-white" : "text-white/90"
          }`}
        >
          Other
        </button>
      </div>
      {otherOpen && (
        <input
          aria-label="Custom trick name"
          value={custom}
          disabled={disabled}
          maxLength={TRICK_NAME_MAX}
          onChange={(event) => {
            setCustom(event.target.value);
            choose(OTHER_TRICK_ID, event.target.value);
          }}
          placeholder="Name your trick"
          className="mt-2 min-h-11 w-full rounded-xl border border-border bg-transparent px-3 font-body text-base text-white outline-none placeholder:text-faint"
        />
      )}
      {selection && formatTrickDisplayName(selection) && (
        <p className="font-body text-xs text-brand-orange/80 pt-2 text-center">
          Set your {formatTrickDisplayName(selection)}
        </p>
      )}
      {!selection && <p className="text-xs text-faint pt-2 text-center">Pick a trick to start recording</p>}
    </div>
  );
}

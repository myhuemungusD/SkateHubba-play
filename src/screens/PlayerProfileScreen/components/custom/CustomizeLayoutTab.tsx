import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pin } from "lucide-react";
import {
  fetchPinnableClips,
  LIMITS,
  moveSection,
  togglePinnedClip,
  type PinnableClip,
} from "../../../../services/profileCustom";
import { label, SECTION_LABELS, type TabProps } from "./customizeParts";

/** Layout tab: section order, signature showcase and pinned clips. */
export function CustomizeLayoutTab({ uid, draft, set }: TabProps & { uid: string }) {
  const [clips, setClips] = useState<PinnableClip[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchPinnableClips(uid).then((c) => {
      if (alive) setClips(c);
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  return (
    <div>
      <p className={label}>SECTION ORDER</p>
      <ol className="mb-6 space-y-1.5">
        {draft.sections.map((id, i) => (
          <li key={id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5">
            <span className="font-body text-sm text-white">{SECTION_LABELS[id]}</span>
            <span className="flex gap-1">
              <button
                type="button"
                aria-label={`Move ${SECTION_LABELS[id]} up`}
                disabled={i === 0}
                onClick={() => set("sections", moveSection(draft.sections, id, -1))}
                className="min-h-[36px] min-w-[36px] text-white/80 disabled:opacity-30"
              >
                <ArrowUp size={16} className="mx-auto" />
              </button>
              <button
                type="button"
                aria-label={`Move ${SECTION_LABELS[id]} down`}
                disabled={i === draft.sections.length - 1}
                onClick={() => set("sections", moveSection(draft.sections, id, 1))}
                className="min-h-[36px] min-w-[36px] text-white/80 disabled:opacity-30"
              >
                <ArrowDown size={16} className="mx-auto" />
              </button>
            </span>
          </li>
        ))}
      </ol>

      <label className="mb-6 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
        <span className="font-body text-sm text-white">Highlight signature pieces</span>
        <input
          type="checkbox"
          checked={draft.showcaseSignature}
          onChange={(e) => set("showcaseSignature", e.target.checked)}
        />
      </label>

      <p className={label}>
        PINNED CLIPS · {draft.pinnedClipIds.length}/{LIMITS.pinnedClips}
      </p>
      {clips.length === 0 ? (
        <p className="font-body text-xs text-subtle">Post a clip to pin it here.</p>
      ) : (
        <ul className="space-y-1.5">
          {clips.map((c) => {
            const on = draft.pinnedClipIds.includes(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("pinnedClipIds", togglePinnedClip(draft.pinnedClipIds, c.id))}
                  className="flex w-full min-h-[40px] items-center justify-between rounded-lg bg-white/5 px-3 text-left font-body text-sm text-white"
                >
                  <span className="truncate">{c.trickName}</span>
                  <Pin size={14} style={{ color: on ? draft.accent : "rgba(255,255,255,0.3)" }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

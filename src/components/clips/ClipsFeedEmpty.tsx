import { FilmIcon } from "../icons";

/** No-clips placeholder shown when the random pool comes back empty. */
export function ClipsFeedEmpty() {
  return (
    <div className="flex flex-col items-center py-10 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30">
      <FilmIcon size={24} className="mb-3 text-faint" />
      <p className="font-body text-sm text-dim">No clips yet.</p>
      <p className="font-body text-xs text-faint mt-1">Land a trick to start filling the feed.</p>
    </div>
  );
}

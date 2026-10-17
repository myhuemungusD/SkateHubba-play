import type { PinnableClip } from "../../../../services/profileCustom";
import { SectionHeader } from "../SectionHeader";

/** Up to 3 pinned clips, shown first like Instagram/TikTok pins. Nothing when none. */
export function PinnedClips({ clips }: { clips: PinnableClip[] }) {
  if (clips.length === 0) return null;
  return (
    <section aria-label="Pinned clips" data-testid="pinned-clips" className="mb-8">
      <SectionHeader title="PINNED" count={clips.length} />
      <div className="grid grid-cols-3 gap-2">
        {clips.map((c) => (
          <figure key={c.id} className="overflow-hidden rounded-xl border border-border bg-surface">
            <video
              src={c.videoUrl}
              poster={c.thumbnailUrl ?? undefined}
              muted
              playsInline
              loop
              preload="metadata"
              controls
              className="aspect-[9/16] w-full object-cover bg-black"
            />
            <figcaption className="truncate px-2 py-1 font-body text-[11px] text-white/80">{c.trickName}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

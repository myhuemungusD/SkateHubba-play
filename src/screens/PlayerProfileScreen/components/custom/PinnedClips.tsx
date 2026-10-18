import { lazy, Suspense, useState } from "react";
import { Scissors } from "lucide-react";
import type { PinnableClip } from "../../../../services/profileCustom";
import { SectionHeader } from "../SectionHeader";

const UserClipUploadModal = lazy(() =>
  import("../../../../components/UserClipUpload").then((m) => ({ default: m.UserClipUploadModal })),
);

interface Props {
  clips: PinnableClip[];
  /**
   * Set only on your OWN profile with the clip editor on: each clip gets an
   * Edit button that opens it in the same editor flow as posting. Edits post
   * as a new clip; the original stays put.
   */
  editor?: { uid: string; username: string };
}

/** Up to 3 pinned clips, shown first like Instagram/TikTok pins. Nothing when none. */
export function PinnedClips({ clips, editor }: Props) {
  const [editing, setEditing] = useState<PinnableClip | null>(null);
  if (clips.length === 0) return null;
  return (
    <section aria-label="Pinned clips" data-testid="pinned-clips" className="mb-8">
      <SectionHeader title="PINNED" count={clips.length} />
      <div className="grid grid-cols-3 gap-2">
        {clips.map((c) => (
          <figure key={c.id} className="relative overflow-hidden rounded-xl border border-border bg-surface">
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
            {editor && (
              <button
                type="button"
                onClick={() => setEditing(c)}
                aria-label={`Edit ${c.trickName}`}
                className="absolute right-1 top-1 inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg bg-black/60 text-white focus-visible:outline-2 focus-visible:outline-brand-orange"
              >
                <Scissors size={14} aria-hidden="true" />
              </button>
            )}
            <figcaption className="truncate px-2 py-1 font-body text-[11px] text-white/80">{c.trickName}</figcaption>
          </figure>
        ))}
      </div>
      {editor && editing && (
        <Suspense fallback={null}>
          <UserClipUploadModal
            uid={editor.uid}
            username={editor.username}
            editFirst
            initialClip={{ videoUrl: editing.videoUrl, trickName: editing.trickName }}
            onClose={() => setEditing(null)}
            onPosted={() => setEditing(null)}
          />
        </Suspense>
      )}
    </section>
  );
}

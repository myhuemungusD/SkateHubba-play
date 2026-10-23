import { useEffect, useState } from "react";
import { Film, MapPin } from "lucide-react";
import { Link } from "react-router";
import { fetchProClipReel, fetchProSpots, type ProSpot } from "../../services/proShowcase";
import type { PinnableClip } from "../../services/profileCustom";

const H3 = "mb-2 flex items-center gap-1.5 font-display text-sm tracking-[0.2em] text-brand-orange";
const CARD = "mb-4 rounded-2xl border border-white/[0.06] bg-surface p-4 shadow-card";

interface Props {
  uid: string;
  displayName: string;
  /** Pro viewing their own profile: shows how to fill an empty section. */
  isOwn: boolean;
}

function ClipTile({ clip }: { clip: PinnableClip }) {
  return (
    <figure className="w-40 shrink-0 snap-start">
      <video
        src={clip.videoUrl}
        poster={clip.thumbnailUrl ?? undefined}
        controls
        playsInline
        preload="none"
        aria-label={clip.trickName}
        className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
      />
      <figcaption className="mt-1 truncate font-body text-xs text-white/80">{clip.trickName}</figcaption>
    </figure>
  );
}

/** Pro Clip Reel (pinned clips) and Pro Spots (map-linked, with clips per spot). */
export function ProReelAndSpots({ uid, displayName, isOwn }: Props) {
  const [reel, setReel] = useState<PinnableClip[] | null>(null);
  const [spots, setSpots] = useState<ProSpot[] | null>(null);

  useEffect(() => {
    let live = true;
    void fetchProClipReel(uid).then((r) => live && setReel(r));
    void fetchProSpots(uid).then((s) => live && setSpots(s));
    return () => {
      live = false;
    };
  }, [uid]);

  return (
    <>
      <section aria-label="Clip reel" data-testid="pro-clip-reel" className={CARD}>
        <h3 className={H3}>
          <Film size={12} aria-hidden="true" /> CLIP REEL
        </h3>
        {reel === null ? (
          <p className="font-body text-xs text-white/60">Loading clips…</p>
        ) : reel.length === 0 ? (
          <p className="font-body text-xs text-white/60">
            {isOwn
              ? "Pin up to 3 of your best clips from Customize profile and they show here first."
              : `${displayName} hasn't pinned any clips yet.`}
          </p>
        ) : (
          <div data-scroll-x className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
            {reel.map((c) => (
              <ClipTile key={c.id} clip={c} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Pro spots" data-testid="pro-spots" className={CARD}>
        <h3 className={H3}>
          <MapPin size={12} aria-hidden="true" /> PRO SPOTS
        </h3>
        {spots === null ? (
          <p className="font-body text-xs text-white/60">Loading spots…</p>
        ) : spots.length === 0 ? (
          <p className="font-body text-xs text-white/60">
            {isOwn
              ? "Add a spot on the map or tag a spot on your clips and it shows here."
              : `${displayName} hasn't shared any spots yet.`}
          </p>
        ) : (
          <ul className="space-y-3">
            {spots.map(({ spot, recommended, clips }) => (
              <li key={spot.id} className="rounded-xl border border-white/[0.06] bg-surface-alt p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to={`/spots/${spot.id}`}
                    className="min-w-0 truncate font-display text-sm tracking-wide text-white underline-offset-2 hover:underline"
                  >
                    {spot.name}
                  </Link>
                  <span className="shrink-0 font-body text-label text-white/60">
                    {recommended ? "Recommended · " : ""}
                    {clips.length} {clips.length === 1 ? "clip" : "clips"}
                  </span>
                </div>
                {clips.length > 0 && (
                  <div data-scroll-x className="-mx-1 mt-2 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
                    {clips.slice(0, 6).map((c) => (
                      <ClipTile key={c.id} clip={c} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

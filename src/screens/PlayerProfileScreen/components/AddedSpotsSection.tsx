import { useEffect, useState } from "react";
import { Link } from "react-router";
import { listSpotsByCreator } from "../../../services/spots";
import type { Spot } from "../../../types/spot";
import { AddedSpotsPlaceholder } from "./AddedSpotsPlaceholder";

interface Props {
  /** Profile whose spots are listed. The parent only mounts this for the owner. */
  uid: string;
  /**
   * Called when the user taps ADD A SPOT. Omit to render the button disabled.
   */
  onAddSpot?: () => void;
}

/**
 * Spots this player added, from `spots` where `createdBy` is their uid.
 *
 * The empty state stays when the query returns nothing. A failed read is not
 * treated as empty — that would tell the player they have no spots when the
 * list simply did not load.
 */
export function AddedSpotsSection({ uid, onAddSpot }: Props) {
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSpots(null);
    setFailed(false);
    listSpotsByCreator(uid)
      .then((rows) => {
        if (!cancelled) setSpots(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (failed) {
    return (
      <section
        aria-label="Spots you've added"
        data-testid="added-spots-error"
        className="mb-8 px-4 py-6 rounded-2xl border border-border bg-surface/40 text-center"
      >
        <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2">SPOTS YOU&apos;VE ADDED</h2>
        <p className="font-body text-sm text-muted">Couldn&apos;t load your spots. Try again in a moment.</p>
      </section>
    );
  }

  if (spots === null) {
    return (
      <section
        aria-label="Spots you've added"
        aria-busy="true"
        data-testid="added-spots-loading"
        className="mb-8 px-4 py-6 rounded-2xl border border-border bg-surface/40 text-center"
      >
        <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2">SPOTS YOU&apos;VE ADDED</h2>
        <p className="font-body text-sm text-muted">Loading spots…</p>
      </section>
    );
  }

  if (spots.length === 0) {
    return <AddedSpotsPlaceholder onAddSpot={onAddSpot} />;
  }

  return (
    <section aria-label="Spots you've added" data-testid="added-spots-list" className="mb-8">
      <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-3 px-1">SPOTS YOU&apos;VE ADDED</h2>
      <ul className="space-y-2">
        {spots.map((spot) => (
          <li key={spot.id}>
            <Link
              to={`/spots/${spot.id}`}
              className="flex min-h-[44px] items-center rounded-2xl border border-border bg-surface px-4 py-3 font-body text-sm text-white hover:border-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              <span className="truncate">{spot.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!onAddSpot}
        onClick={onAddSpot}
        className="mt-3 inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-full bg-brand-orange/[0.12] border border-brand-orange/30 font-display text-xs tracking-wider text-brand-orange disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        aria-label="Add a spot on the map"
      >
        ADD A SPOT
      </button>
    </section>
  );
}

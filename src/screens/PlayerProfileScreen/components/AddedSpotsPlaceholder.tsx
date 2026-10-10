/**
 * Empty state for the "Spots you've added" section.
 *
 * Shown only when `listSpotsByCreator` returns nothing. The CTA is live: the
 * parent passes `onAddSpot`, which routes to `/map?add=1` and opens the Add
 * Spot sheet. The prop stays optional so an unwired caller gets a disabled
 * button rather than a dead-looking live one.
 */
interface Props {
  /**
   * Called when the user taps the CTA. Omit to render the button disabled —
   * the affordance stays honest when there is nowhere to send the user.
   */
  onAddSpot?: () => void;
}

export function AddedSpotsPlaceholder({ onAddSpot }: Props) {
  return (
    <section
      aria-label="Spots you've added"
      data-testid="added-spots-placeholder"
      className="mb-8 px-4 py-6 rounded-2xl border border-dashed border-border bg-surface/40 text-center animate-fade-in"
    >
      <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-2">SPOTS YOU&apos;VE ADDED</h2>
      <p className="font-body text-sm text-muted mb-3">Add spots to see them here.</p>
      <button
        type="button"
        disabled={!onAddSpot}
        onClick={onAddSpot}
        className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-full bg-brand-orange/[0.12] border border-brand-orange/30 font-display text-xs tracking-wider text-brand-orange disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        aria-label="Add a spot on the map"
      >
        ADD A SPOT
      </button>
    </section>
  );
}

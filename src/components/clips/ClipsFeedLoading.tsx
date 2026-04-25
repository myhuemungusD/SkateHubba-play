/** Skeleton placeholder shown while the random clip pool is being fetched. */
export function ClipsFeedLoading() {
  return (
    <div
      className="glass-card rounded-2xl overflow-hidden animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Loading clips"
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-surface-alt border border-border" />
          <div className="h-3 w-20 rounded-md bg-surface-alt" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-10 rounded-md bg-surface-alt" />
          <div className="h-3 w-12 rounded-md bg-surface-alt/70" />
        </div>
      </div>
      <div className="px-4">
        <div className="w-full aspect-[9/16] max-h-[560px] rounded-xl bg-surface-alt border border-border" />
      </div>
      <div className="px-4 pt-3">
        <div className="h-5 w-40 rounded-md bg-surface-alt" />
      </div>
      <div className="px-4 pt-3 pb-4 flex items-center gap-2">
        <div className="h-11 w-16 rounded-xl bg-surface-alt" />
        <div className="h-11 flex-1 rounded-xl bg-surface-alt" />
        <div className="h-11 w-20 rounded-xl bg-surface-alt" />
      </div>
      <span className="sr-only">Loading feed…</span>
    </div>
  );
}

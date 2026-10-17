import { Btn } from "../ui/Btn";
import { FilmIcon } from "../icons";

export function ClipsFeedError({
  error,
  errorCode,
  onRetry,
}: {
  error: string;
  errorCode: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 mb-3 border border-brand-red/30">
      <p className="font-body text-sm text-white/80 mb-3">{error}</p>
      {errorCode && import.meta.env.DEV && <p className="font-body text-[10px] text-faint mb-3">code: {errorCode}</p>}
      <Btn onClick={onRetry} variant="secondary">
        Try again
      </Btn>
    </div>
  );
}

export function ClipsFeedSkeleton() {
  return (
    <div
      className="absolute inset-0 z-20 animate-pulse bg-black"
      role="status"
      aria-busy="true"
      aria-label="Loading clips"
    >
      <div className="absolute bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-4 h-8 w-40 rounded-md bg-white/10" />
      <div className="absolute bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-4 h-11 w-11 rounded-full bg-white/10" />
      <span className="sr-only">Loading feed…</span>
    </div>
  );
}

/**
 * Shown when the page loaded clips but every one of them was filtered out
 * on the client — blocked author, reported, or thumbed down this session.
 * Distinct from {@link ClipsFeedEmpty} ("no clips exist yet"): here there IS
 * more to see, so the affordance is a refetch rather than an invitation to
 * go film something.
 */
export function ClipsFeedExhausted({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex flex-col items-center py-10 border border-white/[0.06] rounded-2xl bg-surface shadow-card">
      <FilmIcon size={24} className="mb-3 text-faint" />
      <p className="font-body text-sm text-dim">That&apos;s everything in this batch.</p>
      <p className="font-body text-xs text-faint mt-1 mb-3">Pull in more clips from the feed.</p>
      <Btn onClick={onReload} variant="secondary">
        Load more clips
      </Btn>
    </div>
  );
}

export function ClipsFeedEmpty() {
  return (
    <div className="flex flex-col items-center py-10 border border-white/[0.06] rounded-2xl bg-surface shadow-card">
      <FilmIcon size={24} className="mb-3 text-faint" />
      <p className="font-body text-sm text-dim">No clips yet.</p>
      <p className="font-body text-xs text-faint mt-1">Land a trick to start filling the feed.</p>
    </div>
  );
}

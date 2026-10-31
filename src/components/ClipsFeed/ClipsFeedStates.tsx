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
    <div role="alert" className="rounded-2xl p-5 mb-3 border border-brand-red/30 bg-surface">
      <p className="font-body text-sm text-white/80 mb-3">{error}</p>
      {errorCode && import.meta.env.DEV && <p className="font-body text-label text-faint mb-3">code: {errorCode}</p>}
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
    <FeedNotice
      title="That's everything in this batch."
      body="Pull in more clips from the feed."
      action="Load more clips"
      onAction={onReload}
    />
  );
}

/**
 * Shown when the feed has no user posts at all. Game clips stay out of the
 * public feed, so the way to fill it is posting a clip: the CTA opens the
 * same upload sheet as the header's POST button.
 */
export function ClipsFeedEmpty({ onPostClip }: { onPostClip: () => void }) {
  return (
    <FeedNotice
      title="Feed's empty. Go fill it."
      body="Film a line, post it, and it shows up here for the crew."
      action="Post a clip"
      onAction={onPostClip}
    />
  );
}

/** The empty and exhausted states share one layout: headline, line, primary button. */
function FeedNotice({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center px-6 py-10 border border-white/[0.06] rounded-2xl bg-surface shadow-card text-center">
      <FilmIcon size={24} className="mb-3 text-faint" />
      <h3 className="font-display text-lg tracking-wide text-white">{title}</h3>
      <p className="font-body text-sm text-dim mt-1 mb-5">{body}</p>
      <Btn onClick={onAction}>{action}</Btn>
    </div>
  );
}

/**
 * Signed-out /feed paint. Matches the full-screen vertical player: a black
 * frame, the clip poster, and the same skeleton bars the feed shows while
 * clips resolve. The poster stays inside a 9/16 frame so the pre-JS wordmark
 * remains the largest contentful element. No Firebase imports — this stays
 * on the entry chunk.
 */
export function BootFeed() {
  return (
    <div className="relative h-dvh bg-black">
      <h1 className="sr-only">Clips</h1>
      <div className="absolute inset-0" role="status" aria-busy="true" aria-label="Loading clips">
        <img
          src="/sh-video-poster.webp"
          alt=""
          width={360}
          height={640}
          fetchPriority="high"
          decoding="async"
          className="mx-auto aspect-[9/16] h-full max-h-[70dvh] w-auto bg-black object-cover"
        />
        <div className="absolute bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-4 h-8 w-40 rounded-md bg-white/10" />
        <div className="absolute bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-4 h-11 w-11 rounded-full bg-white/10" />
        <span className="sr-only">Loading feed…</span>
      </div>
    </div>
  );
}

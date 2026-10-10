/**
 * Signed-out /feed paint. The poster is a real image so LCP is not a video
 * element and not text that arrives only after Firebase Auth resolves.
 * No Firebase imports — this stays on the entry chunk.
 */
export function BootFeed() {
  return (
    <div className="relative min-h-dvh bg-background/40">
      <div className="px-5 pt-safe pb-4 border-b border-white/[0.04] glass max-w-[430px] mx-auto">
        <h1 className="font-display text-fluid-2xl leading-none text-white tracking-wide">Clips</h1>
      </div>
      <div className="px-5 pt-7 max-w-[430px] mx-auto">
        <div
          className="glass-card rounded-2xl overflow-hidden"
          role="status"
          aria-busy="true"
          aria-label="Loading clips"
        >
          <img
            src="/sh-video-poster.webp"
            alt=""
            width={360}
            height={640}
            fetchPriority="high"
            decoding="async"
            className="w-full aspect-[9/16] max-h-[560px] object-cover bg-black"
          />
          <span className="sr-only">Loading feed…</span>
        </div>
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div role="status" aria-label="Loading" className="flex items-center justify-center min-h-dvh bg-[#0A0A0A]">
      <div className="flex flex-col items-center gap-5 animate-scale-in">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-orange animate-spin" />
          <div className="absolute inset-1.5 rounded-full border border-transparent border-t-brand-orange/40 animate-spin [animation-duration:1.5s] [animation-direction:reverse]" />
        </div>
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">
          SKATEHUBBA<span className="text-subtle">™</span>
        </span>
      </div>
    </div>
  );
}

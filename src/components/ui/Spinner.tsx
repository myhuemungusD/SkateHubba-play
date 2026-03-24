export function Spinner() {
  return (
    <div role="status" aria-label="Loading" className="flex items-center justify-center min-h-dvh bg-[#0A0A0A]">
      <div className="flex flex-col items-center gap-5 animate-scale-in">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-orange animate-spin" />
          <div className="absolute inset-2 rounded-full border border-transparent border-t-brand-orange/30 animate-spin [animation-duration:1.5s] [animation-direction:reverse]" />
          <div className="absolute inset-0 rounded-full shadow-[0_0_20px_rgba(255,107,0,0.1)]" />
        </div>
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">
          SKATEHUBBA<span className="text-subtle">™</span>
        </span>
      </div>
    </div>
  );
}

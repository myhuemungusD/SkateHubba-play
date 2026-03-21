export function Spinner() {
  return (
    <div role="status" aria-label="Loading" className="flex items-center justify-center min-h-dvh bg-black">
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="w-10 h-10 border-2 border-border border-t-brand-orange rounded-full animate-spin" />
        <span className="font-display text-sm tracking-[0.25em] text-brand-orange">SKATEHUBBA™</span>
      </div>
    </div>
  );
}

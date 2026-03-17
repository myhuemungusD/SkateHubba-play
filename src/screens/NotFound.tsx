export function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-4">SKATEHUBBA™</span>
      <h1 className="font-display text-[clamp(64px,14vw,120px)] text-white leading-none">BAIL!</h1>
      <p className="font-body text-base text-[#888] max-w-xs mt-4 leading-relaxed">
        Looks like you landed on a page that doesn't exist. Even the best skaters bail sometimes.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-8 px-8 py-3 rounded-xl bg-brand-orange text-white font-display tracking-wider text-lg transition-all duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        Back to Lobby
      </button>
    </main>
  );
}

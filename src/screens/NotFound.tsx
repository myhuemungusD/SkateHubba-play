export function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <img src="/logonew.webp" alt="SkateHubba" draggable={false} className="h-8 w-auto select-none mb-4" />
      <h1 className="font-display text-[clamp(64px,14vw,120px)] text-white leading-none animate-scale-in">BAIL!</h1>
      <p className="font-body text-base text-muted max-w-xs mt-4 leading-relaxed">
        Looks like you landed on a page that doesn't exist. Even the best skaters bail sometimes.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-8 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-brand-orange to-[#FF8533] text-white font-display tracking-wider text-lg transition-all duration-300 active:scale-[0.97] hover:-translate-y-0.5 shadow-[0_2px_12px_rgba(255,107,0,0.2)] hover:shadow-[0_6px_28px_rgba(255,107,0,0.28)] ring-1 ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        Back to Lobby
      </button>
    </main>
  );
}

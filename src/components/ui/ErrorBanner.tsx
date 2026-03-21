export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="w-full p-3 rounded-xl bg-[rgba(255,61,0,0.06)] backdrop-blur-sm border border-brand-red/40 mb-4 flex justify-between items-center shadow-glow-red animate-scale-in"
    >
      <span className="font-body text-sm text-brand-red">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-brand-red/70 hover:text-brand-red text-lg leading-none ml-2 p-1 transition-colors"
          aria-label="Dismiss error"
        >
          ×
        </button>
      )}
    </div>
  );
}

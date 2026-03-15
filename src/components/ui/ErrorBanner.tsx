export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="w-full p-3 rounded-xl bg-[rgba(255,61,0,0.08)] border border-brand-red mb-4 flex justify-between items-center"
    >
      <span className="font-body text-sm text-brand-red">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-brand-red text-lg leading-none ml-2 p-1"
          aria-label="Dismiss error"
        >
          ×
        </button>
      )}
    </div>
  );
}

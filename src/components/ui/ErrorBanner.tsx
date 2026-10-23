/** `messageId` lets a field point aria-describedby at the message text. */
export function ErrorBanner({
  message,
  onDismiss,
  messageId,
}: {
  message: string;
  onDismiss?: () => void;
  messageId?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="w-full p-3.5 rounded-2xl bg-[rgba(255,61,0,0.06)] backdrop-blur-sm border border-brand-red/30 mb-4 flex justify-between items-center shadow-[0_0_20px_rgba(255,61,0,0.06)] animate-scale-in"
    >
      <span id={messageId} className="font-body text-sm text-brand-red leading-snug">
        {message}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-brand-red/50 hover:text-brand-red text-lg leading-none ml-3 p-1 transition-colors duration-200 rounded-lg hover:bg-brand-red/[0.08]"
          aria-label="Dismiss error"
        >
          ×
        </button>
      )}
    </div>
  );
}

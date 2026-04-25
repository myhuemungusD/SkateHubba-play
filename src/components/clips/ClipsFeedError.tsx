import { Btn } from "../ui/Btn";

export interface ClipsFeedErrorProps {
  message: string;
  errorCode: string | null;
  onRetry: () => void;
}

/** Inline error card with a retry CTA. Surfaces the Firestore code in dev. */
export function ClipsFeedError({ message, errorCode, onRetry }: ClipsFeedErrorProps) {
  return (
    <div className="glass-card rounded-2xl p-5 mb-3 border border-brand-red/30">
      <p className="font-body text-sm text-white/80 mb-3">{message}</p>
      {errorCode && import.meta.env.DEV && (
        <p className="font-body text-[10px] text-faint mb-3">code: {errorCode}</p>
      )}
      <Btn onClick={onRetry} variant="secondary">
        Try again
      </Btn>
    </div>
  );
}

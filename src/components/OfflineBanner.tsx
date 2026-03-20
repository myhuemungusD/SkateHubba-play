import { useOnlineStatus } from "../hooks/useOnlineStatus";

/** A slim banner that appears at the top of the screen when the device goes offline. */
export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="sticky top-0 z-50 bg-brand-red text-white text-center font-body text-xs py-1.5 tracking-wide"
    >
      You&apos;re offline — changes will sync when reconnected
    </div>
  );
}

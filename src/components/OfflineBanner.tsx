import { useOnlineStatus } from "../hooks/useOnlineStatus";

/** A slim banner that appears at the top of the screen when the device goes offline. */
export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      className="sticky top-0 z-50 bg-gradient-to-r from-brand-red to-[#FF4A1A] text-white text-center font-body text-xs py-2 tracking-wide shadow-[0_2px_8px_rgba(255,61,0,0.2)]"
    >
      You&apos;re offline — changes will sync when reconnected
    </div>
  );
}

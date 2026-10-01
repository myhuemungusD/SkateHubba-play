import { useNotifications } from "../context/NotificationContext";
import { Toast } from "./Toast";

export function ToastContainer() {
  const { toasts, dismissToast } = useNotifications();

  // Always mounted, empty or not — a game-critical toast ("it's your turn")
  // must land in an ALREADY-PRESENT live region to be reliably announced.
  // Returning null when empty (the old behavior) meant every toast was the
  // first child of a brand-new live region, which screen readers aren't
  // guaranteed to pick up.
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[360px] z-50 flex flex-col gap-2 pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast notification={t} onDismiss={dismissToast} />
        </div>
      ))}
    </div>
  );
}

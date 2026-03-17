import { useNotifications } from "../context/NotificationContext";
import { Toast } from "./Toast";

export function ToastContainer() {
  const { toasts, dismissToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div
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

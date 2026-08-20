import type { AppNotification } from "../context/NotificationContext";
import { notificationIcon, notificationAccentText } from "../lib/notificationMeta";

function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface NotificationRowProps {
  notification: AppNotification;
  /** Whether activating the row does anything (open a game / clear unread). */
  clickable: boolean;
  /** True while this row's game is being fetched on demand. */
  loading: boolean;
  /** True when the fetch came back empty — the game no longer exists. */
  missing: boolean;
  onActivate: () => void;
  onDismiss: () => void;
}

/**
 * One entry in the notification dropdown.
 *
 * Rendered as div[role="button"] rather than a native <button> so the Delete
 * <button> can live inside without nesting interactive elements.
 */
export function NotificationRow({
  notification: n,
  clickable,
  loading,
  missing,
  onActivate,
  onDismiss,
}: NotificationRowProps) {
  return (
    <div
      role="button"
      tabIndex={clickable ? 0 : -1}
      aria-disabled={!clickable}
      aria-busy={loading || undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={`group w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange ${n.read ? "opacity-60" : ""} ${clickable ? "hover:bg-[rgba(255,107,0,0.04)] cursor-pointer" : ""}`}
    >
      <span className={`shrink-0 text-sm mt-0.5 ${notificationAccentText[n.type]}`}>{notificationIcon[n.type]}</span>
      <div className="min-w-0 flex-1">
        <p className={`font-body text-xs leading-tight ${n.read ? "text-muted" : "text-white"}`}>
          <span className="font-semibold">{n.title}</span>
          {" · "}
          <span className="text-subtle">{n.message}</span>
        </p>
        <p className="font-body text-[10px] text-faint mt-0.5">{loading ? "Opening…" : relativeTime(n.timestamp)}</p>
        {missing && (
          <p role="alert" className="font-body text-[10px] text-brand-red mt-0.5">
            That game is no longer available
          </p>
        )}
      </div>
      {!n.read && <span className="shrink-0 w-2 h-2 rounded-full bg-brand-orange mt-1.5" aria-label="Unread" />}
      <button
        type="button"
        aria-label="Delete notification"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="shrink-0 p-1 text-faint hover:text-brand-red transition-colors opacity-60 hover:opacity-100 focus-visible:opacity-100"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

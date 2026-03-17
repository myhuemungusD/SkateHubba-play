import { useState, useRef, useEffect, useCallback } from "react";
import { useNotifications } from "../context/NotificationContext";

function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const typeIcon: Record<string, string> = {
  game_event: "🎯",
  success: "✓",
  error: "✗",
  info: "ℹ",
};

const typeColor: Record<string, string> = {
  game_event: "text-brand-orange",
  success: "text-brand-green",
  error: "text-brand-red",
  info: "text-[#888]",
};

export function NotificationBell() {
  const { notifications, unreadCount, notifyKey, markAllRead, clearAll, soundEnabled, toggleSound } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        type="button"
        onClick={handleToggle}
        className="relative p-1.5 rounded-lg border border-border hover:border-[#3A3A3A] transition-colors duration-200"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
      >
        <svg
          key={notifyKey}
          className={`text-[#888] hover:text-white transition-colors ${notifyKey > 0 ? "animate-bell-shake" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-brand-orange font-display text-[9px] text-white leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[320px] max-h-[420px] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl animate-fade-in z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-display text-sm tracking-wider text-white">NOTIFICATIONS</span>
            <div className="flex items-center gap-2">
              {/* Sound toggle */}
              <button
                type="button"
                onClick={toggleSound}
                className="text-xs text-[#555] hover:text-white transition-colors p-1"
                aria-label={soundEnabled ? "Mute sounds" : "Unmute sounds"}
                title={soundEnabled ? "Mute sounds" : "Unmute sounds"}
              >
                {soundEnabled ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )}
              </button>
              {/* Mark all read */}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="font-body text-[10px] text-[#555] hover:text-brand-orange transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <svg
                  className="text-[#2E2E2E] mb-2"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p className="font-body text-xs text-[#444]">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors ${n.read ? "opacity-60" : ""}`}
                >
                  <span className={`shrink-0 text-sm mt-0.5 ${typeColor[n.type]}`}>{typeIcon[n.type]}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`font-body text-xs leading-tight ${n.read ? "text-[#888]" : "text-white"}`}>
                      <span className="font-semibold">{n.title}</span>
                      {" · "}
                      <span className="text-[#555]">{n.message}</span>
                    </p>
                    <p className="font-body text-[10px] text-[#444] mt-0.5">{relativeTime(n.timestamp)}</p>
                  </div>
                  {!n.read && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-brand-orange mt-1.5" aria-label="Unread" />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border">
              <button
                type="button"
                onClick={clearAll}
                className="font-body text-[10px] text-[#555] hover:text-brand-red transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

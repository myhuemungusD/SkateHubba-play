import { useState, useRef, useEffect, useCallback } from "react";
import { useNotifications } from "../context/NotificationContext";
import { notificationIcon, notificationAccentText } from "../lib/notificationMeta";
import type { GameDoc } from "../services/games";

function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationBell({ games, onOpenGame }: { games?: GameDoc[]; onOpenGame?: (g: GameDoc) => void }) {
  const {
    notifications,
    unreadCount,
    notifyKey,
    markRead,
    markAllRead,
    clearAll,
    dismissNotification,
    soundEnabled,
    toggleSound,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
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
        className="relative p-2 rounded-xl border border-border hover:border-border-hover hover:bg-white/[0.02] transition-all duration-300"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
      >
        <svg
          key={notifyKey}
          className={`text-muted hover:text-white transition-colors ${notifyKey > 0 ? "animate-bell-shake" : ""}`}
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
        <div className="absolute right-0 top-full mt-2 w-[320px] max-h-[420px] flex flex-col rounded-2xl border border-white/[0.06] bg-surface/95 backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.2)] animate-scale-in z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-display text-sm tracking-wider text-white">NOTIFICATIONS</span>
            <div className="flex items-center gap-2">
              {/* Sound toggle */}
              <button
                type="button"
                onClick={toggleSound}
                className="text-xs text-subtle hover:text-white transition-colors p-1"
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
                  className="font-body text-[10px] text-subtle hover:text-brand-orange transition-colors"
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
              notifications.map((n) => {
                const game = n.gameId && games ? games.find((g) => g.id === n.gameId) : undefined;
                const clickable = !!(game && onOpenGame);
                const activate = () => {
                  if (!clickable) return;
                  if (!n.read) markRead(n.id);
                  onOpenGame(game);
                  setOpen(false);
                };
                // Row is div[role="button"] (not <button>) so the Delete <button>
                // can safely live inside without invalid nested interactives.
                return (
                  <div
                    role="button"
                    tabIndex={clickable ? 0 : -1}
                    aria-disabled={!clickable}
                    key={n.id}
                    onClick={activate}
                    onKeyDown={(e) => {
                      if (!clickable) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        activate();
                      }
                    }}
                    className={`group w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange ${n.read ? "opacity-60" : ""} ${clickable ? "hover:bg-[rgba(255,107,0,0.04)] cursor-pointer" : ""}`}
                  >
                    <span className={`shrink-0 text-sm mt-0.5 ${notificationAccentText[n.type]}`}>
                      {notificationIcon[n.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`font-body text-xs leading-tight ${n.read ? "text-muted" : "text-white"}`}>
                        <span className="font-semibold">{n.title}</span>
                        {" · "}
                        <span className="text-subtle">{n.message}</span>
                      </p>
                      <p className="font-body text-[10px] text-[#444] mt-0.5">{relativeTime(n.timestamp)}</p>
                    </div>
                    {!n.read && (
                      <span className="shrink-0 w-2 h-2 rounded-full bg-brand-orange mt-1.5" aria-label="Unread" />
                    )}
                    <button
                      type="button"
                      aria-label="Delete notification"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotification(n.id);
                      }}
                      className="shrink-0 p-0.5 text-[#444] hover:text-brand-red transition-colors opacity-0 group-hover:opacity-100"
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
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border">
              <button
                type="button"
                onClick={clearAll}
                className="font-body text-[10px] text-subtle hover:text-brand-red transition-colors"
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

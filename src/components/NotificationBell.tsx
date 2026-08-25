import { useState, useRef, useEffect, useCallback } from "react";
import { useNotifications, type AppNotification } from "../context/NotificationContext";
import { NotificationRow } from "./NotificationRow";
import { getNotificationGame } from "../services/notifications";
import type { GameDoc } from "../services/games";

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
  // Row whose game is being fetched, and the row whose fetch came back empty.
  // Both are single-valued: only one row can be activated at a time.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [missingId, setMissingId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Close the panel and drop the "no longer available" marker with it —
   * the message describes one activation attempt, so it must not survive
   * into the next time the panel is opened.
   */
  const closePanel = useCallback(() => {
    setOpen(false);
    setMissingId(null);
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closePanel]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
    setMissingId(null);
  }, []);

  /** Dismiss a row, clearing its missing marker so the message can't outlive it. */
  const handleDismiss = useCallback(
    (id: string) => {
      dismissNotification(id);
      setMissingId((prev) => (prev === id ? null : prev));
    },
    [dismissNotification],
  );

  /**
   * Activate a notification row.
   *
   * Marking as read never depends on the game being resolvable — an entry the
   * caller can't open is still an entry the user wants off their unread pile.
   * When the game isn't in the caller's list (a completed game, a stale push,
   * or a list that hasn't hydrated yet) we fetch it on demand instead of
   * rendering a dead row.
   */
  const activate = useCallback(
    async (n: AppNotification, cached: GameDoc | undefined) => {
      if (!n.read) markRead(n.id);
      if (!n.gameId || !onOpenGame) return;
      if (cached) {
        onOpenGame(cached);
        closePanel();
        return;
      }
      setPendingId(n.id);
      setMissingId(null);
      const game = await getNotificationGame(n.gameId);
      setPendingId(null);
      if (!game) {
        setMissingId(n.id);
        return;
      }
      onOpenGame(game);
      closePanel();
    },
    [markRead, onOpenGame, closePanel],
  );

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
                <p className="font-body text-xs text-faint">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                const game = n.gameId && games ? games.find((g) => g.id === n.gameId) : undefined;
                // A row is interactive if there's anything for it to do:
                // open a game, or clear its own unread state.
                const clickable = !!(n.gameId && onOpenGame) || !n.read;
                return (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    clickable={clickable}
                    loading={pendingId === n.id}
                    missing={missingId === n.id}
                    onActivate={() => {
                      if (!clickable || pendingId) return;
                      void activate(n, game);
                    }}
                    onDismiss={() => handleDismiss(n.id)}
                  />
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

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { playChime, isSoundEnabled, setSoundEnabled, type ChimeType } from "../services/sounds";

/* ── Types ─────────────────────────────────── */

export type NotificationType = "game_event" | "success" | "error" | "info";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  chime?: ChimeType;
  gameId?: string;
}

interface NotifyOpts {
  type: NotificationType;
  title: string;
  message: string;
  chime?: ChimeType;
  gameId?: string;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  toasts: AppNotification[];
  unreadCount: number;
  /** Increments each time a new notification arrives — use as React key for animations */
  notifyKey: number;
  notify: (opts: NotifyOpts) => void;
  dismissToast: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  soundEnabled: boolean;
  toggleSound: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}

/* ── Persistence helpers ───────────────────── */

const MAX_STORED = 50;
const TOAST_DURATION = 4000;

function storageKey(uid: string) {
  return `skate_notifs_${uid}`;
}

function loadNotifications(uid: string): AppNotification[] {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    return raw ? (JSON.parse(raw) as AppNotification[]) : [];
  } catch {
    return [];
  }
}

function saveNotifications(uid: string, notifications: AppNotification[]) {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(notifications.slice(0, MAX_STORED)));
  } catch {
    /* quota exceeded — ignore */
  }
}

/* ── Provider ──────────────────────────────── */

let idCounter = 0;

export function NotificationProvider({ uid, children }: { uid: string | null; children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [notifyKey, setNotifyKey] = useState(0);
  const [soundEnabled, setSoundEnabledState] = useState(isSoundEnabled);
  const uidRef = useRef(uid);
  uidRef.current = uid;

  // Load persisted notifications when uid changes
  useEffect(() => {
    if (uid) {
      setNotifications(loadNotifications(uid));
    } else {
      setNotifications([]);
    }
    setToasts([]);
  }, [uid]);

  // Persist when notifications change
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  useEffect(() => {
    if (uid) saveNotifications(uid, notifications);
  }, [uid, notifications]);

  const notify = useCallback((opts: NotifyOpts) => {
    const n: AppNotification = {
      id: `n_${Date.now()}_${++idCounter}`,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      timestamp: Date.now(),
      read: false,
      chime: opts.chime,
      gameId: opts.gameId,
    };

    // Add to persistent notifications
    setNotifications((prev) => [n, ...prev].slice(0, MAX_STORED));
    setNotifyKey((k) => k + 1);

    // Add to toast queue (max 3 visible)
    setToasts((prev) => [n, ...prev].slice(0, 3));

    // Play chime
    if (opts.chime) playChime(opts.chime);

    // Auto-dismiss toast
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== n.id));
    }, TOAST_DURATION);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabledState((prev) => {
      const next = !prev;
      setSoundEnabled(next);
      return next;
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const value: NotificationContextValue = {
    notifications,
    toasts,
    unreadCount,
    notifyKey,
    notify,
    dismissToast,
    markRead,
    markAllRead,
    clearAll,
    soundEnabled,
    toggleSound,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

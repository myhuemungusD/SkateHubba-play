import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { playChime, isSoundEnabled, setSoundEnabled, type ChimeType } from "../services/sounds";
import { playHaptic, type HapticType } from "../services/haptics";
import {
  deleteNotification,
  deleteUserNotifications,
  markNotificationRead,
  type NotificationEvent,
} from "../services/notifications";
import { TOAST_DURATION } from "../constants/ui";

/** Chime → haptic mapping. `general` falls back to the lightweight toast pulse. */
const chimeHapticMap: Record<ChimeType, HapticType> = {
  your_turn: "your_turn",
  new_challenge: "new_challenge",
  game_won: "game_won",
  game_lost: "game_lost",
  nudge: "nudge",
  general: "toast",
};

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
  /** Firestore document ID — present when the notification originated from a Firestore doc */
  firestoreId?: string;
  /**
   * The underlying `/notifications` doc `type` (e.g. "game_won"), when known.
   * Carried so `hydrate` can recognise a server doc as the same event a local
   * watcher already surfaced. `chime` is not a substitute — it is lossy
   * (judge_invite collapses to "general").
   */
  sourceType?: string;
}

interface NotifyOpts {
  type: NotificationType;
  title: string;
  message: string;
  chime?: ChimeType;
  gameId?: string;
  firestoreId?: string;
  sourceType?: string;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  toasts: AppNotification[];
  unreadCount: number;
  /** Increments each time a new notification arrives — use as React key for animations */
  notifyKey: number;
  notify: (opts: NotifyOpts) => void;
  /** Merge server-side unread notifications into the bell. Silent — see below. */
  hydrate: (events: NotificationEvent[]) => void;
  dismissToast: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  dismissNotification: (id: string) => void;
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
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear all toast timers on unmount
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

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
      firestoreId: opts.firestoreId,
      sourceType: opts.sourceType,
    };

    // Add to persistent notifications
    setNotifications((prev) => [n, ...prev].slice(0, MAX_STORED));
    setNotifyKey((k) => k + 1);

    // Add to toast queue (max 3 visible)
    setToasts((prev) => [n, ...prev].slice(0, 3));

    // Play chime + haptic. Chime-tagged events map to their semantic haptic;
    // plain toasts still get a light tactile pulse so UI acks feel physical.
    if (opts.chime) {
      playChime(opts.chime);
      playHaptic(chimeHapticMap[opts.chime]);
    } else {
      playHaptic("toast");
    }

    // Auto-dismiss toast
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== n.id));
      toastTimers.current.delete(n.id);
    }, TOAST_DURATION);
    toastTimers.current.set(n.id, timer);
  }, []);

  /**
   * Merge the server's unread notifications into the bell.
   *
   * The bell used to be backed ONLY by `skate_notifs_${uid}` in localStorage,
   * so anything that arrived while the app was closed existed on the server and
   * nowhere else: a challenge received overnight left no in-app trace, and
   * signing in on a second device showed an empty bell.
   *
   * Silent by contract — no chime, no haptic, no toast, and no `notifyKey` bump.
   * These are not arrivals; the user was away when they happened, and the key
   * drives the bell's arrival animation.
   *
   * Idempotent: the listener re-seeds on every resubscribe (uid change,
   * remount), so this runs repeatedly with overlapping data.
   */
  const hydrate = useCallback((events: NotificationEvent[]) => {
    if (events.length === 0) return;
    setNotifications((prev) => {
      const byFirestoreId = new Set(prev.map((n) => n.firestoreId).filter(Boolean));
      // Locally-generated entries have no firestoreId. `useGameCompletionWatcher`
      // produces exactly one per game from the games snapshot, so a server doc
      // for the same (gameId, type) is that same event arriving by the other
      // channel — not a second notification. Server-vs-server duplicates can't
      // reach this branch: they always differ by firestoreId.
      const localKeys = new Set(
        prev.filter((n) => !n.firestoreId && n.gameId && n.sourceType).map((n) => `${n.gameId}:${n.sourceType}`),
      );

      const additions: AppNotification[] = [];
      for (const evt of events) {
        if (byFirestoreId.has(evt.firestoreId)) continue;
        if (localKeys.has(`${evt.gameId}:${evt.type}`)) continue;
        byFirestoreId.add(evt.firestoreId);
        additions.push({
          id: `n_${evt.firestoreId}`,
          type: "game_event",
          title: evt.title,
          message: evt.body,
          timestamp: evt.createdAtMs || Date.now(),
          read: false,
          chime: undefined,
          gameId: evt.gameId,
          firestoreId: evt.firestoreId,
          sourceType: evt.type,
        });
      }
      if (additions.length === 0) return prev;

      return [...prev, ...additions].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_STORED);
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target?.firestoreId && !target.read) {
        queueMicrotask(() =>
          markNotificationRead(target.firestoreId!).catch(() => {
            /* best-effort */
          }),
        );
      }
      return prev.map((n) => (n.id === id ? { ...n, read: true } : n));
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const toMark = prev.filter((n) => !n.read && n.firestoreId).map((n) => n.firestoreId!);
      if (toMark.length > 0) {
        queueMicrotask(() => {
          for (const fsId of toMark) {
            markNotificationRead(fsId).catch(() => {
              /* best-effort */
            });
          }
        });
      }
      return prev.map((n) => (n.read ? n : { ...n, read: true }));
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    const currentUid = uidRef.current;
    if (currentUid) {
      deleteUserNotifications(currentUid).catch(() => {
        /* best-effort */
      });
    }
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target?.firestoreId) {
        const fsId = target.firestoreId;
        queueMicrotask(() =>
          deleteNotification(fsId).catch(() => {
            /* best-effort */
          }),
        );
      }
      return prev.filter((n) => n.id !== id);
    });
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabledState((prev) => {
      const next = !prev;
      setSoundEnabled(next);
      return next;
    });
  }, []);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      toasts,
      unreadCount,
      notifyKey,
      notify,
      hydrate,
      dismissToast,
      markRead,
      markAllRead,
      clearAll,
      dismissNotification,
      soundEnabled,
      toggleSound,
    }),
    [
      notifications,
      toasts,
      unreadCount,
      notifyKey,
      notify,
      hydrate,
      dismissToast,
      markRead,
      markAllRead,
      clearAll,
      dismissNotification,
      soundEnabled,
      toggleSound,
    ],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

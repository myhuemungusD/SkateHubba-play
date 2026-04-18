import { useState, useRef, useCallback, useEffect } from "react";
import type { AppNotification } from "../context/NotificationContext";
import { notificationIcon, notificationAccentBg, notificationAccentText } from "../lib/notificationMeta";
const SWIPE_THRESHOLD = 80;

export function Toast({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragXRef = useRef(0);
  const startXRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setExiting(true);
  }, []);

  // Run onDismiss after exit animation completes
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onDismiss(notification.id), 250);
    return () => clearTimeout(timer);
  }, [exiting, notification.id, onDismiss]);

  // Touch / pointer swipe-to-dismiss
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startXRef.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startXRef.current === null) return;
    const dx = e.clientX - startXRef.current;
    if (dx > 0) {
      dragXRef.current = dx;
      setDragX(dx);
    }
  }, []);

  const onPointerUp = useCallback(() => {
    if (dragXRef.current > SWIPE_THRESHOLD) {
      dismiss();
    } else {
      setDragX(0);
    }
    dragXRef.current = 0;
    startXRef.current = null;
  }, [dismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative flex items-start gap-3 p-3.5 pr-8 rounded-2xl glass-card shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] overflow-hidden touch-pan-y select-none ${exiting ? "animate-toast-out" : "animate-toast-in"}`}
      // Inline style required: transform/opacity are driven by continuous pointer drag state
      style={{
        transform: dragX > 0 ? `translateX(${dragX}px)` : undefined,
        opacity: dragX > 0 ? 1 - dragX / 200 : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Left accent bar */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${notificationAccentBg[notification.type]} rounded-l-xl`}
      />

      {/* Icon */}
      <span className={`shrink-0 text-lg leading-none mt-0.5 ${notificationAccentText[notification.type]}`}>
        {notificationIcon[notification.type]}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm tracking-wider text-white leading-tight">{notification.title}</p>
        <p className="font-body text-xs text-muted mt-0.5 leading-snug truncate">{notification.message}</p>
      </div>

      {/* Dismiss button — 44×44 tap target per iOS HIG / Material guidelines.
          The glyph is visually small but the hit area is comfortable so thumbs
          don't mis-tap onto the clip label below. */}
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-0 right-0 w-11 h-11 inline-flex items-center justify-center text-subtle hover:text-white transition-colors text-base leading-none rounded-tr-2xl focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange"
        aria-label="Dismiss notification"
      >
        ×
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-border">
        <div
          className={`h-full origin-left ${notificationAccentBg[notification.type]} [animation:progress-shrink_4000ms_linear_forwards]`}
        />
      </div>
    </div>
  );
}

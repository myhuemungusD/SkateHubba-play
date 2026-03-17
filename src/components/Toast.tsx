import { useState, useRef, useCallback } from "react";
import type { AppNotification } from "../context/NotificationContext";

const TOAST_DURATION = 4000;
const SWIPE_THRESHOLD = 80;

const accentColor: Record<AppNotification["type"], string> = {
  game_event: "bg-brand-orange",
  success: "bg-brand-green",
  error: "bg-brand-red",
  info: "bg-[#888]",
};

const iconMap: Record<AppNotification["type"], string> = {
  game_event: "🎯",
  success: "✓",
  error: "✗",
  info: "ℹ",
};

const iconTextColor: Record<AppNotification["type"], string> = {
  game_event: "text-brand-orange",
  success: "text-brand-green",
  error: "text-brand-red",
  info: "text-[#888]",
};

export function Toast({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const [dragX, setDragX] = useState(0);
  const startXRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(notification.id), 250);
  }, [notification.id, onDismiss]);

  // Touch / pointer swipe-to-dismiss
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startXRef.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startXRef.current === null) return;
    const dx = e.clientX - startXRef.current;
    if (dx > 0) setDragX(dx);
  }, []);

  const onPointerUp = useCallback(() => {
    if (dragX > SWIPE_THRESHOLD) {
      dismiss();
    } else {
      setDragX(0);
    }
    startXRef.current = null;
  }, [dragX, dismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative flex items-start gap-3 p-3 pr-8 rounded-xl border border-border bg-surface/95 backdrop-blur-sm shadow-lg overflow-hidden touch-pan-y select-none ${exiting ? "animate-toast-out" : "animate-toast-in"}`}
      style={{
        transform: dragX > 0 ? `translateX(${dragX}px)` : undefined,
        opacity: dragX > 0 ? 1 - dragX / 200 : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentColor[notification.type]} rounded-l-xl`} />

      {/* Icon */}
      <span className={`shrink-0 text-lg leading-none mt-0.5 ${iconTextColor[notification.type]}`}>
        {iconMap[notification.type]}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm tracking-wider text-white leading-tight">{notification.title}</p>
        <p className="font-body text-xs text-[#888] mt-0.5 leading-snug truncate">{notification.message}</p>
      </div>

      {/* Dismiss button */}
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-2 right-2 text-[#555] hover:text-white transition-colors text-sm leading-none p-1"
        aria-label="Dismiss notification"
      >
        ×
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-border">
        <div
          className={`h-full ${accentColor[notification.type]}`}
          style={{ animation: `progress-shrink ${TOAST_DURATION}ms linear forwards` }}
        />
      </div>
    </div>
  );
}

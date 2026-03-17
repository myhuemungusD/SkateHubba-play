import type { NotificationType } from "../context/NotificationContext";

export const notificationIcon: Record<NotificationType, string> = {
  game_event: "🎯",
  success: "✓",
  error: "✗",
  info: "ℹ",
};

export const notificationAccentBg: Record<NotificationType, string> = {
  game_event: "bg-brand-orange",
  success: "bg-brand-green",
  error: "bg-brand-red",
  info: "bg-[#888]",
};

export const notificationAccentText: Record<NotificationType, string> = {
  game_event: "text-brand-orange",
  success: "text-brand-green",
  error: "text-brand-red",
  info: "text-[#888]",
};

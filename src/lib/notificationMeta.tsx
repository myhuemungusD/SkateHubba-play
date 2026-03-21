import type { ReactNode } from "react";
import type { NotificationType } from "../context/NotificationContext";
import { TargetIcon } from "../components/icons";

export const notificationIcon: Record<NotificationType, ReactNode> = {
  game_event: <TargetIcon size={14} />,
  success: "✓",
  error: "✗",
  info: "ℹ",
};

export const notificationAccentBg: Record<NotificationType, string> = {
  game_event: "bg-brand-orange",
  success: "bg-brand-green",
  error: "bg-brand-red",
  info: "bg-muted",
};

export const notificationAccentText: Record<NotificationType, string> = {
  game_event: "text-brand-orange",
  success: "text-brand-green",
  error: "text-brand-red",
  info: "text-muted",
};

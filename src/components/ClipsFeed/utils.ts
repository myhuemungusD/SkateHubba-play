import type { ClipDoc } from "../../services/clips";

/** Firestore error codes that map to "service-side issue, not your network". */
const SERVICE_ERROR_CODES = new Set(["permission-denied", "failed-precondition", "unauthenticated"]);

export function errorCodeFor(err: unknown): string | undefined {
  return typeof err === "object" && err && typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : undefined;
}

/** Shown when the viewer's block list can't be loaded: the feed won't guess who is blocked. */
export const BLOCK_LIST_ERROR =
  "Couldn't load your blocked players, so the feed is paused. Check your connection and try again.";
export const BLOCK_LIST_ERROR_CODE = "block-list/unavailable";

export function copyForError(code: string | undefined): string {
  if (code && SERVICE_ERROR_CODES.has(code)) {
    return "Feed temporarily unavailable — please try again in a moment.";
  }
  return "Couldn't load the feed. Check your connection and try again.";
}

/** Human-readable "2m ago" / "3h ago" / "Apr 12" timestamp. */
export function relativeClipTime(createdAt: ClipDoc["createdAt"]): string {
  if (!createdAt || typeof createdAt.toMillis !== "function") return "";
  const millis = createdAt.toMillis();
  const deltaMs = Date.now() - millis;
  if (deltaMs < 0) return "just now";
  const minutes = deltaMs / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  const d = new Date(millis);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${month} ${d.getDate()}`;
}

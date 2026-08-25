/**
 * Small formatting/messaging helpers shared by the admin console panels.
 * Kept out of the components so each panel stays inside its LOC budget and
 * the strings an operator reads are asserted in one place.
 */

/**
 * User-facing message for a failed admin action. Service functions throw
 * `Error`s with operator-readable copy (permission denied, target missing);
 * anything else degrades to a generic retry line rather than leaking a raw
 * object into a toast.
 */
export function errorMessage(err: unknown, fallback = "Please try again."): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** "3m ago" / "5h ago" / "Apr 12" — mirrors the clips feed's relative time. */
export function relativeAge(date: Date | null): string {
  if (!date) return "unknown";
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 0) return "just now";
  const minutes = deltaMs / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${month} ${date.getDate()}`;
}

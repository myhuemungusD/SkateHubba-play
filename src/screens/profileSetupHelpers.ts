import { USERNAME_MAX, USERNAME_MIN } from "../services/users";

export const STANCES = [
  { value: "Regular", foot: "Left foot forward" },
  { value: "Goofy", foot: "Right foot forward" },
] as const;

// Sanitisation regex is the inverse of USERNAME_RE — strips any char that
// wouldn't pass validation. Kept local because only the UI pre-filters input.
export const SANITIZE_RE = /[^a-z0-9_]/g;

export function sanitizeDisplayName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(SANITIZE_RE, "").slice(0, USERNAME_MAX);
}

export function usernameNote(name: string, available: boolean | null, availabilityError: string): string {
  if (name.length < USERNAME_MIN) return `Min ${USERNAME_MIN} characters, letters/numbers/underscore`;
  // When the availability probe has errored out (permission race, hung
  // request, App Check stall) we fall back to the canonical uniqueness
  // check inside createProfile's transaction — so stop showing "Checking..."
  // forever and let the user submit.
  if (availabilityError) return "Couldn't verify — we'll double-check when you submit";
  if (available === null) return "Checking...";
  const handle = `@${name}`;
  return available ? `${handle} is available ✓` : `${handle} is taken ✗`;
}

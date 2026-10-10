/**
 * Auth's user creation time wins. The profile clock is the fallback for a
 * lookup that failed. A backdated profile must not make a new account look old.
 */
export function preferAccountCreatedMs(
  authCreationTime: string | null | undefined,
  profileMs: number | null,
): number | null {
  if (typeof authCreationTime === "string" && authCreationTime.length > 0) {
    const parsed = Date.parse(authCreationTime);
    if (Number.isFinite(parsed)) return parsed;
  }
  return profileMs;
}

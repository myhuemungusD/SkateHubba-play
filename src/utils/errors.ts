/**
 * Dependency-free error helpers.
 *
 * Split out of `utils/helpers.ts` (which re-exports them) because helpers
 * pulls in `services/games` → the Firebase SDK. Light modules that sit on the
 * landing page's first-paint path (e.g. `services/nativeBridge`, used by the
 * landing InviteButton) import from here so the Firebase chunk stays off that
 * path.
 */

/** Extract a Firebase error code from an unknown error value. */
export function getErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}

/**
 * Extract a human-readable message from a Firebase Auth error (or any unknown error).
 * Firebase errors may be plain objects with `code` + `message` fields rather than
 * Error instances, which causes `String(err)` to produce `[object Object]`.
 */
export function parseFirebaseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.code === "string" && obj.code) return obj.code;
    return JSON.stringify(err);
  }
  return String(err);
}

/**
 * Return a user-facing message from an unknown thrown value, falling back to
 * the provided `fallback` string when the value carries no human-readable text.
 *
 * Rules:
 *  - Error instances → err.message
 *  - Plain objects with a non-empty string `message` field → that message
 *  - Everything else (raw codes, primitives, null) → fallback
 */
export function getUserMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

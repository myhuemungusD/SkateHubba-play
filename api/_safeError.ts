/**
 * Log-safe descriptions of a caught error, for the Vercel functions under `api/`.
 *
 * An error's message is free text that can quote its input: a `JSON.parse`
 * failure on a secret env quotes the secret, a Firestore error quotes a doc
 * path with a uid in it. Log lines and response bodies get one of these
 * instead, never `err.message`.
 */

/** The error's class name when it is a plain identifier; `"Error"` otherwise. */
export function safeErrorName(err: unknown): string {
  const raw = err instanceof Error ? err.name : typeof err;
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(raw) ? raw : "Error";
}

/**
 * A machine code like Firebase's `auth/id-token-expired` when the error
 * carries a well-formed one; else the class name (`safeErrorName`).
 */
export function safeErrorCode(err: unknown): string {
  const code = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "string" && /^[a-z][a-z0-9-]{0,39}(\/[a-z0-9-]{1,63})?$/i.test(code)) return code;
  return safeErrorName(err);
}

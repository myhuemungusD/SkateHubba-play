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
 * A machine code when the error carries a well-formed one, else the class name
 * (`safeErrorName`). Accepted codes:
 * - Firebase style, lowercase: `auth/id-token-expired`, `permission-denied`
 * - Node errno style: `ENOTFOUND`, `ECONNRESET`
 * - gRPC numeric (Firestore Admin): `5` becomes `grpc-5`
 *
 * Case matters on purpose: a Firebase uid is 28 mixed-case characters, so it
 * can never pass as a code even if some SDK put one there.
 */
export function safeErrorCode(err: unknown): string {
  const code = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "number" && Number.isInteger(code) && code >= 0 && code < 100) return `grpc-${code}`;
  if (typeof code === "string" && /^(?:[a-z][a-z0-9-]{0,39}(?:\/[a-z0-9-]{1,63})?|E[A-Z0-9]{1,30})$/.test(code)) {
    return code;
  }
  return safeErrorName(err);
}

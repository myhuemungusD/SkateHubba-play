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
 * - Firebase style: lowercase words joined by hyphens, with one optional
 *   `service/` prefix: `auth/id-token-expired`, `permission-denied`
 * - Node style: `E` plus uppercase letters and underscores: `ENOTFOUND`,
 *   `EAI_AGAIN`, `ERR_REQUIRE_ESM`
 * - gRPC numeric (Firestore Admin): `5` becomes `grpc-5`
 *
 * No form accepts digits, and each is single-case: a Firebase uid is 28 random
 * mixed-case letters and digits, so it can't pass as a code even if some SDK
 * put one there.
 */
export function safeErrorCode(err: unknown): string {
  const code = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "number" && Number.isInteger(code) && code >= 0 && code < 100) return `grpc-${code}`;
  if (
    typeof code === "string" &&
    code.length <= 64 &&
    /^(?:[a-z]+(?:-[a-z]+)*(?:\/[a-z]+(?:-[a-z]+)*)?|E[A-Z_]{1,39})$/.test(code)
  ) {
    return code;
  }
  return safeErrorName(err);
}

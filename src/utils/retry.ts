/**
 * Returns true for errors that are worth retrying (transient network/server
 * failures). Returns false for permanent errors that retrying won't fix, such
 * as permission denied (403), not found (404), or invalid argument errors.
 *
 * Also returns false for user-initiated cancellation (AbortError,
 * `storage/canceled`) — callers treat these as explicit stops, not failures
 * to retry against.
 */
export function isRetryable(err: unknown): boolean {
  // User-initiated aborts are never retryable — DOMException("AbortError")
  // is produced by `uploadVideo` when a caller signals cancellation.
  if (err instanceof Error && err.name === "AbortError") return false;
  if (!(err instanceof Error)) return true; // unknown shape — optimistically retry

  // Firebase / gRPC error codes that are permanent (don't retry)
  const code = (err as { code?: string }).code ?? "";
  const permanentCodes = new Set([
    "permission-denied",
    "unauthenticated",
    "not-found",
    "already-exists",
    "invalid-argument",
    "failed-precondition",
    "out-of-range",
    "unimplemented",
    // Firebase Storage error codes — these are permanent failures that
    // no amount of retry will recover from. `storage/canceled` is the
    // SDK's signal for a task.cancel() invocation (i.e., our own abort
    // path) and must not trigger another attempt. `storage/retry-limit-
    // exceeded` means the SDK already exhausted its own internal retry
    // budget, so our wrapper retrying again just wastes user bandwidth.
    "storage/unauthorized",
    "storage/unauthenticated",
    "storage/object-not-found",
    "storage/invalid-argument",
    "storage/quota-exceeded",
    "storage/retry-limit-exceeded",
    "storage/canceled",
  ]);
  if (permanentCodes.has(code)) return false;

  // HTTP status codes embedded in error messages
  const msg = err.message.toLowerCase();
  if (msg.includes("403") || msg.includes("401") || msg.includes("404")) return false;

  return true; // transient (network timeout, quota, unavailable, etc.)
}

/**
 * Retry a promise-returning function with exponential backoff.
 * Only retries on transient errors — permanent errors (403, 404, permission
 * denied, etc.) are thrown immediately without waiting.
 *
 * @param fn          - The async operation to retry.
 * @param maxAttempts - Total number of attempts (default 3).
 * @param baseDelayMs - Initial delay between attempts in ms (doubles each retry).
 */
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Don't retry permanent errors
      if (!isRetryable(err)) throw err;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

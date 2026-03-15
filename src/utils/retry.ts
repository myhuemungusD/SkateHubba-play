/**
 * Retry a promise-returning function with exponential backoff.
 *
 * @param fn          - The async operation to retry.
 * @param maxAttempts - Total number of attempts (default 3).
 * @param baseDelayMs - Initial delay between attempts in ms (doubles each retry).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * Math.pow(2, attempt))
        );
      }
    }
  }
  throw lastError;
}

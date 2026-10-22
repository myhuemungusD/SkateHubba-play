/**
 * Log-safe description of a caught error for Cloud Functions logs: the same
 * contract as `api/_safeError.ts` (the Vercel functions are a separate deploy
 * and cannot import from here). An error's message is free text that can quote
 * a uid (Storage object names are `{role}-{uid}.mp4`) or a doc path, so logs
 * get a machine code or a class name, never the message.
 */
export function safeErrorCode(err: unknown): string {
  const code = err !== null && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "number" && Number.isInteger(code) && code >= 0 && code < 1000) return `code-${code}`;
  if (typeof code === "string" && /^(?:[a-z][a-z0-9-]{0,39}(?:\/[a-z0-9-]{1,63})?|E[A-Z0-9]{1,30})$/.test(code)) {
    return code;
  }
  const name = err instanceof Error ? err.name : typeof err;
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : "Error";
}

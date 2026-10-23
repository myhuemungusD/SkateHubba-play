import { safeErrorName } from "../_safeError.js";

/**
 * The 500 for a failed WTT cron run: one structured log line with the error
 * class, and a fixed body. Neither carries the error's message.
 */
export function wttFailureResponse(event: string, error: unknown, publicError: string): Response {
  console.error(JSON.stringify({ event, errorName: safeErrorName(error) }));
  return Response.json({ error: publicError, message: "Internal error." }, { status: 500 });
}

import { logger } from "../../services/logger";

/**
 * Catch handler for a scrub seek. A failed preview frame is cosmetic, so the
 * editor keeps the user's edits and only logs it, instead of an error screen.
 */
export function logSeekFailure(err: unknown): void {
  logger.warn("clip_editor_seek_failed", { error: String(err) });
}

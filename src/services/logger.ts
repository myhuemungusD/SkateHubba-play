/**
 * Structured logging service.
 *
 * Wraps console.* with structured JSON in production and readable output in
 * development. Business-critical events are forwarded to Sentry as
 * breadcrumbs so they appear alongside error reports.
 *
 * Usage:
 *   import { logger } from "../services/logger";
 *   logger.info("game_created", { gameId, challengerUid });
 *   logger.warn("forfeit_expired", { gameId });
 *   logger.error("upload_failed", { gameId, error: err.message });
 */

import { addBreadcrumb } from "../lib/sentry";
import { redactPII } from "../utils/pii";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  event: string;
  ts: string;
  data?: Record<string, unknown>;
}

const IS_DEV = import.meta.env.DEV;

function emit(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    event,
    ts: new Date().toISOString(),
    ...(data ? { data } : {}),
  };

  /* v8 ignore start -- IS_DEV is always true in test env; production path is integration-tested */
  // Console output — human-readable in dev, structured JSON in production
  const consoleMethod = level === "debug" ? "debug" : level;
  if (IS_DEV) {
    const extra = data ? data : "";
    console[consoleMethod](`[${level.toUpperCase()}]`, event, extra);
  } else {
    console[consoleMethod](JSON.stringify(entry));
  }
  /* v8 ignore stop */

  // Forward info+ events to Sentry as breadcrumbs for context in error reports.
  // Redact PII (email, *uid) here so call sites never need to think about it.
  if (level !== "debug") {
    addBreadcrumb({
      category: "app",
      message: event,
      level: level === "info" ? "info" : level === "warn" ? "warning" : "error",
      data: redactPII(data),
    });
  }
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>) => emit("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};

/**
 * Business metrics — track key product events with structured data.
 * These go through the logger so they appear in both console output and
 * Sentry breadcrumbs. They also call the analytics service for Vercel
 * Analytics tracking.
 */
export const metrics = {
  gameCreated: (gameId: string, challengerUid: string) => logger.info("metric.game_created", { gameId, challengerUid }),

  trickSet: (gameId: string, trickName: string, hasVideo: boolean) =>
    logger.info("metric.trick_set", { gameId, trickName, hasVideo }),

  matchSubmitted: (gameId: string, landed: boolean) => logger.info("metric.match_submitted", { gameId, landed }),

  gameCompleted: (gameId: string, winnerUid: string, totalTurns: number) =>
    logger.info("metric.game_completed", { gameId, winnerUid, totalTurns }),

  gameForfeit: (gameId: string, winnerUid: string) => logger.info("metric.game_forfeit", { gameId, winnerUid }),

  videoUploaded: (gameId: string, sizeBytes: number, durationMs: number) =>
    logger.info("metric.video_uploaded", { gameId, sizeBytes, durationMs }),

  signUp: (method: string, uid: string) => logger.info("metric.sign_up", { method, uid }),

  signIn: (method: string, uid: string) => logger.info("metric.sign_in", { method, uid }),

  accountDeleted: (uid: string) => logger.info("metric.account_deleted", { uid }),
};

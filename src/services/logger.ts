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
  // Redact PII (email, *uid, *username) and URL tokens once, for both the
  // production console line and the Sentry breadcrumb, so call sites never
  // need to think about it.
  const redacted = redactPII(data);

  // Console output: human-readable and raw in dev, one structured JSON line in
  // production. The production line is redacted too: it lands in device logs
  // (Xcode/logcat, Safari Web Inspector) and any console-capturing tool, and
  // as a single JSON string it is out of reach of key-based scrubbing later.
  const consoleMethod = level === "debug" ? "debug" : level;
  if (IS_DEV) {
    const extra = data ? data : "";
    console[consoleMethod](`[${level.toUpperCase()}]`, event, extra);
  } else {
    const entry: LogEntry = {
      level,
      event,
      ts: new Date().toISOString(),
      ...(redacted ? { data: redacted } : {}),
    };
    console[consoleMethod](JSON.stringify(entry));
  }

  // Forward info+ events to Sentry as breadcrumbs for context in error reports.
  if (level !== "debug") {
    addBreadcrumb({
      category: "app",
      message: event,
      level: level === "info" ? "info" : level === "warn" ? "warning" : "error",
      data: redacted,
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

  // Attempt/failure counters let Sentry breadcrumbs preserve full auth-flow
  // context alongside the success metric — denominator for outage alerts.
  signInAttempt: (method: string) => logger.info("metric.sign_in_attempt", { method }),
  signInFailure: (method: string, code: string) => logger.info("metric.sign_in_failure", { method, code }),
  signUpAttempt: (method: string) => logger.info("metric.sign_up_attempt", { method }),
  signUpFailure: (method: string, code: string) => logger.info("metric.sign_up_failure", { method, code }),

  accountDeleted: (uid: string) => logger.info("metric.account_deleted", { uid }),
};

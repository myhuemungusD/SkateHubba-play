import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/sentry", () => ({
  addBreadcrumb: vi.fn(),
}));

import { addBreadcrumb } from "../../lib/sentry";
import { logger, metrics } from "../logger";
import { hashUid } from "../../utils/pii";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logger", () => {
  describe("debug", () => {
    it("logs to console.debug and does NOT add a Sentry breadcrumb", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      logger.debug("test_debug", { key: "val" });
      expect(spy).toHaveBeenCalled();
      expect(addBreadcrumb).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("info", () => {
    it("logs to console.info and adds a Sentry breadcrumb with level info", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      logger.info("test_info", { key: "val" });
      expect(spy).toHaveBeenCalled();
      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ category: "app", message: "test_info", level: "info", data: { key: "val" } }),
      );
      spy.mockRestore();
    });

    it("works without data", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      logger.info("no_data");
      expect(spy).toHaveBeenCalled();
      expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ message: "no_data", data: undefined }));
      spy.mockRestore();
    });
  });

  describe("warn", () => {
    it("logs to console.warn and adds a Sentry breadcrumb with level warning", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      logger.warn("test_warn");
      expect(spy).toHaveBeenCalled();
      expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ level: "warning", message: "test_warn" }));
      spy.mockRestore();
    });
  });

  describe("error", () => {
    it("logs to console.error and adds a Sentry breadcrumb with level error", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      logger.error("test_error", { code: 500 });
      expect(spy).toHaveBeenCalled();
      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ level: "error", message: "test_error", data: { code: 500 } }),
      );
      spy.mockRestore();
    });
  });
});

describe("metrics", () => {
  // Each metric helper delegates to logger.info → addBreadcrumb.
  // We test that each one fires without error and hits Sentry.

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("gameCreated", () => {
    metrics.gameCreated("g1", "u1");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.game_created", data: { gameId: "g1", challengerUid: hashUid("u1") } }),
    );
  });

  it("trickSet", () => {
    metrics.trickSet("g1", "kickflip", true);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.trick_set",
        data: { gameId: "g1", trickName: "kickflip", hasVideo: true },
      }),
    );
  });

  it("matchSubmitted", () => {
    metrics.matchSubmitted("g1", false);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.match_submitted", data: { gameId: "g1", landed: false } }),
    );
  });

  it("gameCompleted", () => {
    metrics.gameCompleted("g1", "u2", 5);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.game_completed",
        data: { gameId: "g1", winnerUid: hashUid("u2"), totalTurns: 5 },
      }),
    );
  });

  it("gameForfeit", () => {
    metrics.gameForfeit("g1", "u2");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.game_forfeit", data: { gameId: "g1", winnerUid: hashUid("u2") } }),
    );
  });

  it("videoUploaded", () => {
    metrics.videoUploaded("g1", 1024, 3000);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.video_uploaded",
        data: { gameId: "g1", sizeBytes: 1024, durationMs: 3000 },
      }),
    );
  });

  it("signUp", () => {
    metrics.signUp("email", "u1");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.sign_up", data: { method: "email", uid: hashUid("u1") } }),
    );
  });

  it("signIn", () => {
    metrics.signIn("google", "u1");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.sign_in", data: { method: "google", uid: hashUid("u1") } }),
    );
  });

  it("accountDeleted", () => {
    metrics.accountDeleted("u1");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.account_deleted", data: { uid: hashUid("u1") } }),
    );
  });

  it("signInAttempt emits the method with no uid", () => {
    metrics.signInAttempt("email");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.sign_in_attempt", data: { method: "email" } }),
    );
  });

  it("signInFailure emits method + code", () => {
    metrics.signInFailure("email", "auth/internal-error");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.sign_in_failure",
        data: { method: "email", code: "auth/internal-error" },
      }),
    );
  });

  it("signUpAttempt emits the method", () => {
    metrics.signUpAttempt("google");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.sign_up_attempt", data: { method: "google" } }),
    );
  });

  it("signUpFailure emits method + code", () => {
    metrics.signUpFailure("email", "auth/weak-password");
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.sign_up_failure",
        data: { method: "email", code: "auth/weak-password" },
      }),
    );
  });
});

describe("logger PII redaction", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("redacts email values in info breadcrumbs", () => {
    logger.info("sign_in_attempt", { email: "a@b.com" });
    expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ data: { email: "[REDACTED_EMAIL]" } }));
  });

  it("hashes uid values in breadcrumbs", () => {
    logger.info("sign_in_success", { uid: "abc123" });
    expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ data: { uid: hashUid("abc123") } }));
  });

  it("hashes any *Uid-keyed value and leaves other fields untouched", () => {
    logger.warn("game_event", { challengerUid: "u1", winnerUid: "u2", gameId: "g1" });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { challengerUid: hashUid("u1"), winnerUid: hashUid("u2"), gameId: "g1" },
      }),
    );
  });

  it("redacts email + uid together on error breadcrumbs", () => {
    logger.error("sign_up_failed", { email: "x@y.com", uid: "abc" });
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { email: "[REDACTED_EMAIL]", uid: hashUid("abc") },
      }),
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/react", () => ({
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from "@sentry/react";
import { logger, metrics } from "../logger";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logger", () => {
  describe("debug", () => {
    it("logs to console.debug and does NOT add a Sentry breadcrumb", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      logger.debug("test_debug", { key: "val" });
      expect(spy).toHaveBeenCalled();
      expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("info", () => {
    it("logs to console.info and adds a Sentry breadcrumb with level info", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      logger.info("test_info", { key: "val" });
      expect(spy).toHaveBeenCalled();
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ category: "app", message: "test_info", level: "info", data: { key: "val" } }),
      );
      spy.mockRestore();
    });

    it("works without data", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      logger.info("no_data");
      expect(spy).toHaveBeenCalled();
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ message: "no_data", data: undefined }),
      );
      spy.mockRestore();
    });
  });

  describe("warn", () => {
    it("logs to console.warn and adds a Sentry breadcrumb with level warning", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      logger.warn("test_warn");
      expect(spy).toHaveBeenCalled();
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ level: "warning", message: "test_warn" }),
      );
      spy.mockRestore();
    });
  });

  describe("error", () => {
    it("logs to console.error and adds a Sentry breadcrumb with level error", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      logger.error("test_error", { code: 500 });
      expect(spy).toHaveBeenCalled();
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
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
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.game_created", data: { gameId: "g1", challengerUid: "u1" } }),
    );
  });

  it("trickSet", () => {
    metrics.trickSet("g1", "kickflip", true);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.trick_set",
        data: { gameId: "g1", trickName: "kickflip", hasVideo: true },
      }),
    );
  });

  it("matchSubmitted", () => {
    metrics.matchSubmitted("g1", false);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.match_submitted", data: { gameId: "g1", landed: false } }),
    );
  });

  it("gameCompleted", () => {
    metrics.gameCompleted("g1", "u2", 5);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.game_completed",
        data: { gameId: "g1", winnerUid: "u2", totalTurns: 5 },
      }),
    );
  });

  it("gameForfeit", () => {
    metrics.gameForfeit("g1", "u2");
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.game_forfeit", data: { gameId: "g1", winnerUid: "u2" } }),
    );
  });

  it("videoUploaded", () => {
    metrics.videoUploaded("g1", 1024, 3000);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "metric.video_uploaded",
        data: { gameId: "g1", sizeBytes: 1024, durationMs: 3000 },
      }),
    );
  });

  it("signUp", () => {
    metrics.signUp("email", "u1");
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.sign_up", data: { method: "email", uid: "u1" } }),
    );
  });

  it("signIn", () => {
    metrics.signIn("google", "u1");
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.sign_in", data: { method: "google", uid: "u1" } }),
    );
  });

  it("accountDeleted", () => {
    metrics.accountDeleted("u1");
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "metric.account_deleted", data: { uid: "u1" } }),
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trackEvent, analytics } from "../analytics";

describe("analytics service", () => {
  let vaSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vaSpy = vi.fn();

    (window as any).va = vaSpy;
  });

  afterEach(() => {
    delete (window as any).va;
  });

  describe("trackEvent", () => {
    it("calls window.va with event name and properties", () => {
      trackEvent("test_event", { key: "value" });
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "test_event", key: "value" });
    });

    it("calls window.va with just the name when no properties", () => {
      trackEvent("simple_event");
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "simple_event" });
    });

    it("does not throw when window.va is not defined", () => {
      delete (window as any).va;
      expect(() => trackEvent("no_va")).not.toThrow();
    });

    it("does not throw when window.va throws", () => {
      vaSpy.mockImplementation(() => {
        throw new Error("va broke");
      });
      expect(() => trackEvent("error_event")).not.toThrow();
    });
  });

  describe("analytics helpers", () => {
    it("gameCreated sends game_created event", () => {
      analytics.gameCreated("g1");
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "game_created", gameId: "g1" });
    });

    it("trickSet sends trick_set event", () => {
      analytics.trickSet("g1", "kickflip");
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "trick_set", gameId: "g1", trickName: "kickflip" });
    });

    it("matchSubmitted sends match_submitted event", () => {
      analytics.matchSubmitted("g1", true);
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "match_submitted", gameId: "g1", landed: true });
    });

    it("gameCompleted sends game_completed event", () => {
      analytics.gameCompleted("g1", false);
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "game_completed", gameId: "g1", won: false });
    });

    it("videoUploaded sends video_uploaded event", () => {
      analytics.videoUploaded(3000, 1024);
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "video_uploaded", durationMs: 3000, sizeBytes: 1024 });
    });

    it("signUp sends sign_up event", () => {
      analytics.signUp("email");
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "sign_up", method: "email" });
    });

    it("signIn sends sign_in event", () => {
      analytics.signIn("google");
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "sign_in", method: "google" });
    });
  });
});

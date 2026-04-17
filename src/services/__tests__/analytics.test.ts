import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPosthogCapture = vi.fn();
vi.mock("../../lib/posthog", () => ({
  captureEvent: (...args: unknown[]) => mockPosthogCapture(...args),
}));

import { trackEvent, analytics } from "../analytics";
import { CONSENT_KEY } from "../../lib/consent";

describe("analytics service", () => {
  let vaSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vaSpy = vi.fn();
    mockPosthogCapture.mockClear();

    (window as unknown as Record<string, unknown>).va = vaSpy;
    // Default-allow for the existing suite; the consent-gating block below
    // covers the declined / unknown cases explicitly.
    localStorage.setItem(CONSENT_KEY, "accepted");
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).va;
    localStorage.clear();
  });

  describe("trackEvent", () => {
    it("calls window.va with event name and properties", () => {
      trackEvent("test_event", { key: "value" });
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "test_event", key: "value" });
    });

    it("fans out the same event to PostHog with the raw properties", () => {
      trackEvent("test_event", { key: "value" });
      expect(mockPosthogCapture).toHaveBeenCalledWith("test_event", { key: "value" });
    });

    it("still fires the Vercel Analytics path when PostHog throws", () => {
      mockPosthogCapture.mockImplementationOnce(() => {
        throw new Error("posthog broke");
      });
      expect(() => trackEvent("ph_error_event", { x: 1 })).not.toThrow();
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "ph_error_event", x: 1 });
    });

    it("still fires the PostHog path when Vercel Analytics throws", () => {
      vaSpy.mockImplementationOnce(() => {
        throw new Error("va broke");
      });
      expect(() => trackEvent("va_error_event", { x: 1 })).not.toThrow();
      expect(mockPosthogCapture).toHaveBeenCalledWith("va_error_event", { x: 1 });
    });

    it("calls window.va with just the name when no properties", () => {
      trackEvent("simple_event");
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "simple_event" });
    });

    it("does not throw when window.va is not defined", () => {
      delete (window as unknown as Record<string, unknown>).va;
      expect(() => trackEvent("no_va")).not.toThrow();
    });

    it("does not throw when window.va throws", () => {
      vaSpy.mockImplementation(() => {
        throw new Error("va broke");
      });
      expect(() => trackEvent("error_event")).not.toThrow();
    });

    it("drops events when consent has not been granted", () => {
      localStorage.removeItem(CONSENT_KEY);
      trackEvent("pre_consent_event", { key: "value" });
      expect(vaSpy).not.toHaveBeenCalled();
      expect(mockPosthogCapture).not.toHaveBeenCalled();
    });

    it("drops events when the user has declined consent", () => {
      localStorage.setItem(CONSENT_KEY, "declined");
      trackEvent("declined_event", { key: "value" });
      expect(vaSpy).not.toHaveBeenCalled();
      expect(mockPosthogCapture).not.toHaveBeenCalled();
    });

    it("emits events once consent flips from declined to accepted", () => {
      localStorage.setItem(CONSENT_KEY, "declined");
      trackEvent("blocked");
      expect(vaSpy).not.toHaveBeenCalled();
      localStorage.setItem(CONSENT_KEY, "accepted");
      trackEvent("allowed");
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "allowed" });
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

    it("challengeFromSpot sends challenge_from_spot event", () => {
      analytics.challengeFromSpot("11111111-2222-3333-4444-555555555555");
      expect(vaSpy).toHaveBeenCalledWith("event", {
        name: "challenge_from_spot",
        spotId: "11111111-2222-3333-4444-555555555555",
      });
    });

    it("mapViewed sends map_viewed event", () => {
      analytics.mapViewed();
      expect(vaSpy).toHaveBeenCalledWith("event", { name: "map_viewed" });
    });

    it("spotPreviewed sends spot_previewed event with the spot id", () => {
      analytics.spotPreviewed("11111111-2222-3333-4444-555555555555");
      expect(vaSpy).toHaveBeenCalledWith("event", {
        name: "spot_previewed",
        spotId: "11111111-2222-3333-4444-555555555555",
      });
    });
  });
});

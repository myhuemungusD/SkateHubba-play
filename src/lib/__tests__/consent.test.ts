import { describe, it, expect, beforeEach, vi } from "vitest";
import { CONSENT_KEY, isAnalyticsAllowed, readConsent, subscribeConsent, writeConsent } from "../consent";

beforeEach(() => {
  localStorage.clear();
});

describe("consent helpers", () => {
  describe("readConsent", () => {
    it("returns null when nothing is stored", () => {
      expect(readConsent()).toBeNull();
    });

    it("returns 'accepted' when accepted is stored", () => {
      localStorage.setItem(CONSENT_KEY, "accepted");
      expect(readConsent()).toBe("accepted");
    });

    it("returns 'declined' when declined is stored", () => {
      localStorage.setItem(CONSENT_KEY, "declined");
      expect(readConsent()).toBe("declined");
    });

    it("returns null for any unknown value", () => {
      localStorage.setItem(CONSENT_KEY, "maybe");
      expect(readConsent()).toBeNull();
    });

    it("returns null when localStorage throws", () => {
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = () => {
        throw new Error("private mode");
      };
      try {
        expect(readConsent()).toBeNull();
      } finally {
        Storage.prototype.getItem = getItem;
      }
    });
  });

  describe("isAnalyticsAllowed", () => {
    it("is false when no value is stored (fail-closed default)", () => {
      expect(isAnalyticsAllowed()).toBe(false);
    });

    it("is false when the user declined", () => {
      localStorage.setItem(CONSENT_KEY, "declined");
      expect(isAnalyticsAllowed()).toBe(false);
    });

    it("is true only when the user accepted", () => {
      localStorage.setItem(CONSENT_KEY, "accepted");
      expect(isAnalyticsAllowed()).toBe(true);
    });
  });

  describe("writeConsent + subscribeConsent", () => {
    it("persists the value to localStorage", () => {
      writeConsent("accepted");
      expect(localStorage.getItem(CONSENT_KEY)).toBe("accepted");
    });

    it("notifies subscribers synchronously on write", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeConsent(listener);
      writeConsent("declined");
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("stops notifying after unsubscribe", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeConsent(listener);
      unsubscribe();
      writeConsent("accepted");
      expect(listener).not.toHaveBeenCalled();
    });

    it("swallows localStorage errors but still notifies subscribers", () => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error("quota");
      };
      const listener = vi.fn();
      const unsubscribe = subscribeConsent(listener);
      try {
        expect(() => writeConsent("accepted")).not.toThrow();
        expect(listener).toHaveBeenCalledTimes(1);
      } finally {
        Storage.prototype.setItem = setItem;
        unsubscribe();
      }
    });
  });

  describe("cross-tab storage sync", () => {
    it("notifies subscribers when another tab writes the consent key", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeConsent(listener);
      window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY, newValue: "accepted" }));
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("ignores storage events for unrelated keys", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeConsent(listener);
      window.dispatchEvent(new StorageEvent("storage", { key: "something_else", newValue: "x" }));
      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });
});

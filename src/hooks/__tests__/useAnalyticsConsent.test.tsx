import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAnalyticsConsent, getSnapshot, getServerSnapshot } from "../useAnalyticsConsent";
import { CONSENT_KEY, writeConsent } from "../../lib/consent";

beforeEach(() => {
  localStorage.clear();
});

describe("useAnalyticsConsent", () => {
  it("returns false before the user has granted consent", () => {
    const { result } = renderHook(() => useAnalyticsConsent());
    expect(result.current).toBe(false);
  });

  it("returns true once consent is already stored", () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    const { result } = renderHook(() => useAnalyticsConsent());
    expect(result.current).toBe(true);
  });

  it("flips reactively when writeConsent runs", () => {
    const { result } = renderHook(() => useAnalyticsConsent());
    expect(result.current).toBe(false);
    act(() => writeConsent("accepted"));
    expect(result.current).toBe(true);
    act(() => writeConsent("declined"));
    expect(result.current).toBe(false);
  });

  it("getSnapshot mirrors isAnalyticsAllowed", () => {
    expect(getSnapshot()).toBe(false);
    localStorage.setItem(CONSENT_KEY, "accepted");
    expect(getSnapshot()).toBe(true);
  });

  it("getServerSnapshot returns false (fail-closed SSR default)", () => {
    expect(getServerSnapshot()).toBe(false);
  });
});

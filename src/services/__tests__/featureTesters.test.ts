import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ getDoc: vi.fn(), warn: vi.fn() }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  getDoc: h.getDoc,
}));
vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));

import { fetchIsFeatureTester, syncFeatureTester } from "../featureTesters";
import { FEATURE_TESTER_STORAGE_KEY, isClosetEnabled, isFeatureTesterOverrideActive } from "../../lib/featureFlags";

const listed = (uids: unknown) => ({ exists: () => true, data: () => ({ uids }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("fetchIsFeatureTester", () => {
  it("is true only when the uid is in the list", async () => {
    h.getDoc.mockResolvedValueOnce(listed(["a", "b"]));
    await expect(fetchIsFeatureTester("a")).resolves.toBe(true);
    h.getDoc.mockResolvedValueOnce(listed(["b"]));
    await expect(fetchIsFeatureTester("a")).resolves.toBe(false);
    h.getDoc.mockResolvedValueOnce(listed("a"));
    await expect(fetchIsFeatureTester("a")).resolves.toBe(false);
    h.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await expect(fetchIsFeatureTester("a")).resolves.toBe(false);
  });

  it("treats permission-denied as not a tester, quietly; logs other errors", async () => {
    h.getDoc.mockRejectedValueOnce({ code: "permission-denied" });
    await expect(fetchIsFeatureTester("a")).resolves.toBe(false);
    expect(h.warn).not.toHaveBeenCalled();
    h.getDoc.mockRejectedValueOnce(new Error("offline"));
    await fetchIsFeatureTester("a");
    h.getDoc.mockRejectedValueOnce("odd");
    await fetchIsFeatureTester("a");
    h.getDoc.mockRejectedValueOnce(null);
    await fetchIsFeatureTester("a");
    expect(h.warn).toHaveBeenCalledWith("feature_testers_read_failed", { error: "offline" });
    expect(h.warn).toHaveBeenCalledWith("feature_testers_read_failed", { error: "odd" });
  });
});

describe("syncFeatureTester", () => {
  it("stores a tester, turns every flag on, and reloads once", async () => {
    const reload = vi.fn();
    expect(isClosetEnabled()).toBe(false);
    h.getDoc.mockResolvedValue(listed(["me"]));
    await expect(syncFeatureTester("me", reload)).resolves.toBe(true);
    expect(localStorage.getItem(FEATURE_TESTER_STORAGE_KEY)).toBe("me");
    expect(isFeatureTesterOverrideActive()).toBe(true);
    expect(isClosetEnabled()).toBe(true);
    await expect(syncFeatureTester("me", reload)).resolves.toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("clears on sign-out or a non-tester sign-in", async () => {
    const reload = vi.fn();
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "me");
    await expect(syncFeatureTester(null, reload)).resolves.toBe(true);
    expect(isFeatureTesterOverrideActive()).toBe(false);
    localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "me");
    h.getDoc.mockRejectedValueOnce({ code: "permission-denied" });
    await syncFeatureTester("other", reload);
    expect(localStorage.getItem(FEATURE_TESTER_STORAGE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads a non-tester with nothing stored", async () => {
    const reload = vi.fn();
    h.getDoc.mockRejectedValueOnce({ code: "permission-denied" });
    await expect(syncFeatureTester("other", reload)).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing when storage is blocked", async () => {
    const reload = vi.fn();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    h.getDoc.mockResolvedValueOnce(listed(["me"]));
    await expect(syncFeatureTester("me", reload)).resolves.toBe(false);
    expect(isFeatureTesterOverrideActive()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("defaults to a real page reload", async () => {
    const reloadSpy = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: reloadSpy });
    h.getDoc.mockResolvedValueOnce(listed(["me"]));
    await syncFeatureTester("me");
    expect(reloadSpy).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("is a no-op in the native shell: no read, no write, no reload", async () => {
    const reload = vi.fn();
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    try {
      h.getDoc.mockResolvedValue(listed(["me"]));
      await expect(syncFeatureTester("me", reload)).resolves.toBe(false);
      localStorage.setItem(FEATURE_TESTER_STORAGE_KEY, "me");
      await expect(syncFeatureTester(null, reload)).resolves.toBe(false);
      expect(localStorage.getItem(FEATURE_TESTER_STORAGE_KEY)).toBe("me");
      expect(h.getDoc).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { Capacitor?: unknown }).Capacitor;
    }
  });
});

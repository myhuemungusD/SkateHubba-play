import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ──────────────────
 * Mirrors spots.test.ts: each Firestore SDK function is a hoisted vi.fn()
 * so we can assert exactly what onboarding writes/reads. doc() returns a
 * structural token capturing the path so we can verify the service hits
 * the canonical private profile doc.
 */
const { mockSetDoc, mockGetDoc, mockDoc, mockOnSnapshot } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDoc: vi.fn(),
  mockDoc: vi.fn((...args: unknown[]) => {
    const segments = args.slice(1).filter((s) => typeof s === "string");
    return { __path: segments.join("/"), id: segments[segments.length - 1] ?? "auto" };
  }),
  mockOnSnapshot: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: mockDoc,
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

// Stub the entire sentry module with a hoisted spy. captureException is
// asserted directly; the rest exist so logger.ts (which imports
// addBreadcrumb from this module) doesn't read undefined when it ticks.
const { mockSentry } = vi.hoisted(() => ({ mockSentry: vi.fn() }));
vi.mock("../../lib/sentry", () => {
  const noop = () => undefined;
  return {
    captureException: mockSentry,
    captureMessage: noop,
    addBreadcrumb: noop,
    setUser: noop,
    initSentry: noop,
  };
});

import {
  TUTORIAL_VERSION,
  getOnboardingState,
  subscribeToOnboardingState,
  markOnboardingCompleted,
  markOnboardingSkipped,
  resetOnboarding,
  getLocalProgress,
  setLocalProgress,
  clearLocalProgress,
  getLocalDismissed,
  setLocalDismissed,
  clearLocalDismissed,
  type LocalOnboardingProgress,
} from "../onboarding";

const UID = "user-1";
const KEY = `skatehubba.onboarding.v${TUTORIAL_VERSION}.${UID}`;
const DISMISSED_KEY = `skatehubba.onboarding.dismissed.v${TUTORIAL_VERSION}.${UID}`;

class FakeTimestamp {
  constructor(private readonly date: Date) {}
  toDate() {
    return this.date;
  }
}

function makeSnap(overrides: Record<string, unknown> = {}) {
  return {
    exists: () => true,
    data: () => ({ ...overrides }),
  };
}

function makeMissingSnap() {
  return { exists: () => false };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

/* ────────────────────────────────────────────
 * Local progress helpers
 * ──────────────────────────────────────────── */

describe("getLocalProgress", () => {
  const validProgress: LocalOnboardingProgress = {
    tutorialVersion: TUTORIAL_VERSION,
    currentStep: 2,
    seenSteps: [0, 1, 2],
  };

  it("returns null when the key is missing", () => {
    expect(getLocalProgress(UID)).toBeNull();
  });

  it("returns null for an empty uid without touching storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem");
    expect(getLocalProgress("")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns the parsed progress on a valid entry", () => {
    window.localStorage.setItem(KEY, JSON.stringify(validProgress));
    expect(getLocalProgress(UID)).toEqual(validProgress);
  });

  it.each([
    ["bad JSON", "not-json{{"],
    ["non-object", JSON.stringify(123)],
    ["missing tutorialVersion", JSON.stringify({ currentStep: 0, seenSteps: [] })],
    ["wrong currentStep type", JSON.stringify({ tutorialVersion: 1, currentStep: "0", seenSteps: [] })],
    ["non-array seenSteps", JSON.stringify({ tutorialVersion: 1, currentStep: 0, seenSteps: "0" })],
    ["non-numeric seenSteps entry", JSON.stringify({ tutorialVersion: 1, currentStep: 0, seenSteps: ["a"] })],
  ])("returns null on shape mismatch — %s", (_label, raw) => {
    window.localStorage.setItem(KEY, raw);
    expect(getLocalProgress(UID)).toBeNull();
  });

  it("returns null when stored tutorialVersion is stale", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ tutorialVersion: TUTORIAL_VERSION + 1, currentStep: 0, seenSteps: [] }),
    );
    expect(getLocalProgress(UID)).toBeNull();
  });

  it("returns null and warns when localStorage.getItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(getLocalProgress(UID)).toBeNull();
    spy.mockRestore();
  });
});

describe("setLocalProgress", () => {
  it("writes JSON to the versioned per-user key", () => {
    const progress: LocalOnboardingProgress = {
      tutorialVersion: TUTORIAL_VERSION,
      currentStep: 1,
      seenSteps: [0, 1],
    };
    setLocalProgress(UID, progress);
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify(progress));
  });

  it("is a no-op for an empty uid", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    setLocalProgress("", { tutorialVersion: 1, currentStep: 0, seenSteps: [] });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("swallows quota exceeded errors", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => setLocalProgress(UID, { tutorialVersion: 1, currentStep: 0, seenSteps: [] })).not.toThrow();
    spy.mockRestore();
  });
});

describe("clearLocalProgress", () => {
  it("removes the stored entry", () => {
    window.localStorage.setItem(KEY, "anything");
    clearLocalProgress(UID);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("is a no-op for an empty uid", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem");
    clearLocalProgress("");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("swallows storage errors", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("nope");
    });
    expect(() => clearLocalProgress(UID)).not.toThrow();
    spy.mockRestore();
  });
});

/* ────────────────────────────────────────────
 * getOnboardingState
 * ──────────────────────────────────────────── */

describe("getOnboardingState", () => {
  it("returns null without touching firestore for an empty uid", async () => {
    expect(await getOnboardingState("")).toBeNull();
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("returns null when the private profile doc does not exist", async () => {
    mockGetDoc.mockResolvedValueOnce(makeMissingSnap());
    expect(await getOnboardingState(UID)).toBeNull();
  });

  it("returns null when none of the onboarding fields are present", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSnap({ emailVerified: true }));
    expect(await getOnboardingState(UID)).toBeNull();
  });

  it("parses completedAt + tutorialVersion when set", async () => {
    const completedAt = new FakeTimestamp(new Date("2026-04-01T00:00:00Z"));
    mockGetDoc.mockResolvedValueOnce(
      makeSnap({ onboardingTutorialVersion: TUTORIAL_VERSION, onboardingCompletedAt: completedAt }),
    );
    const state = await getOnboardingState(UID);
    expect(state?.tutorialVersion).toBe(TUTORIAL_VERSION);
    expect(state?.completedAt).toBe(completedAt);
    expect(state?.skippedAt).toBeNull();
  });

  it("parses skippedAt when set", async () => {
    const skippedAt = new FakeTimestamp(new Date("2026-04-02T00:00:00Z"));
    mockGetDoc.mockResolvedValueOnce(makeSnap({ onboardingSkippedAt: skippedAt }));
    const state = await getOnboardingState(UID);
    expect(state?.skippedAt).toBe(skippedAt);
    expect(state?.completedAt).toBeNull();
    expect(state?.tutorialVersion).toBeNull();
  });

  it("ignores non-Timestamp shaped fields", async () => {
    mockGetDoc.mockResolvedValueOnce(
      makeSnap({
        onboardingTutorialVersion: TUTORIAL_VERSION,
        onboardingCompletedAt: "not-a-timestamp",
        onboardingSkippedAt: { toDate: "still-not-a-fn" },
      }),
    );
    const state = await getOnboardingState(UID);
    expect(state?.completedAt).toBeNull();
    expect(state?.skippedAt).toBeNull();
  });

  it("ignores a non-numeric tutorialVersion field", async () => {
    const completedAt = new FakeTimestamp(new Date());
    mockGetDoc.mockResolvedValueOnce(makeSnap({ onboardingTutorialVersion: "v1", onboardingCompletedAt: completedAt }));
    const state = await getOnboardingState(UID);
    expect(state?.tutorialVersion).toBeNull();
    expect(state?.completedAt).toBe(completedAt);
  });

  it("returns null and reports to Sentry when getDoc throws", async () => {
    mockGetDoc.mockRejectedValueOnce(new Error("permission-denied"));
    expect(await getOnboardingState(UID)).toBeNull();
    expect(mockSentry).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { op: "getOnboardingState" } }),
    );
  });
});

/* ────────────────────────────────────────────
 * Write helpers (start, completed, skipped, reset)
 * ──────────────────────────────────────────── */

describe("subscribeToOnboardingState", () => {
  it("returns a no-op unsubscribe and immediately invokes the callback with null for an empty uid", () => {
    const cb = vi.fn();
    const unsub = subscribeToOnboardingState("", cb);
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("forwards onSnapshot's unsubscribe handle", () => {
    const handle = vi.fn();
    mockOnSnapshot.mockImplementationOnce(() => handle);
    const unsub = subscribeToOnboardingState(UID, vi.fn());
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect(unsub).toBe(handle);
  });

  it("invokes the callback with null when the doc does not exist", () => {
    const cb = vi.fn();
    mockOnSnapshot.mockImplementationOnce((_ref: unknown, onNext: (snap: { exists: () => boolean }) => void) => {
      onNext({ exists: () => false });
      return vi.fn();
    });
    subscribeToOnboardingState(UID, cb);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it("invokes the callback with null when no onboarding fields are set", () => {
    const cb = vi.fn();
    mockOnSnapshot.mockImplementationOnce(
      (_ref: unknown, onNext: (snap: { exists: () => boolean; data: () => Record<string, unknown> }) => void) => {
        onNext({ exists: () => true, data: () => ({ emailVerified: true }) });
        return vi.fn();
      },
    );
    subscribeToOnboardingState(UID, cb);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it("parses completedAt + tutorialVersion when set", () => {
    const completedAt = new FakeTimestamp(new Date("2026-04-01T00:00:00Z"));
    const cb = vi.fn();
    mockOnSnapshot.mockImplementationOnce(
      (_ref: unknown, onNext: (snap: { exists: () => boolean; data: () => Record<string, unknown> }) => void) => {
        onNext({
          exists: () => true,
          data: () => ({ onboardingTutorialVersion: TUTORIAL_VERSION, onboardingCompletedAt: completedAt }),
        });
        return vi.fn();
      },
    );
    subscribeToOnboardingState(UID, cb);
    expect(cb).toHaveBeenCalledWith({
      tutorialVersion: TUTORIAL_VERSION,
      completedAt,
      skippedAt: null,
    });
  });

  it("parses skippedAt when set", () => {
    const skippedAt = new FakeTimestamp(new Date("2026-04-02T00:00:00Z"));
    const cb = vi.fn();
    mockOnSnapshot.mockImplementationOnce(
      (_ref: unknown, onNext: (snap: { exists: () => boolean; data: () => Record<string, unknown> }) => void) => {
        onNext({
          exists: () => true,
          data: () => ({ onboardingSkippedAt: skippedAt }),
        });
        return vi.fn();
      },
    );
    subscribeToOnboardingState(UID, cb);
    expect(cb).toHaveBeenCalledWith({ tutorialVersion: null, completedAt: null, skippedAt });
  });

  it("ignores non-Timestamp shaped fields", () => {
    const cb = vi.fn();
    mockOnSnapshot.mockImplementationOnce(
      (_ref: unknown, onNext: (snap: { exists: () => boolean; data: () => Record<string, unknown> }) => void) => {
        onNext({
          exists: () => true,
          data: () => ({
            onboardingTutorialVersion: TUTORIAL_VERSION,
            onboardingCompletedAt: "not-a-timestamp",
            onboardingSkippedAt: { toDate: "still-not-a-fn" },
          }),
        });
        return vi.fn();
      },
    );
    subscribeToOnboardingState(UID, cb);
    expect(cb).toHaveBeenCalledWith({ tutorialVersion: TUTORIAL_VERSION, completedAt: null, skippedAt: null });
  });

  it("invokes the callback with null and reports to Sentry on subscription error", () => {
    const cb = vi.fn();
    mockOnSnapshot.mockImplementationOnce((_ref: unknown, _onNext: unknown, onError: (err: Error) => void) => {
      onError(new Error("permission-denied"));
      return vi.fn();
    });
    subscribeToOnboardingState(UID, cb);
    expect(cb).toHaveBeenCalledWith(null);
    expect(mockSentry).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { op: "subscribeToOnboardingState" } }),
    );
  });
});

describe("markOnboardingCompleted", () => {
  it("writes serverTimestamp() to completedAt and null to skippedAt", async () => {
    await markOnboardingCompleted(UID);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][1]).toEqual({
      onboardingTutorialVersion: TUTORIAL_VERSION,
      onboardingCompletedAt: "SERVER_TS",
      onboardingSkippedAt: null,
    });
  });

  it("is a no-op for an empty uid", async () => {
    await markOnboardingCompleted("");
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("swallows failures", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("offline"));
    await expect(markOnboardingCompleted(UID)).resolves.toBeUndefined();
  });
});

describe("markOnboardingSkipped", () => {
  it("writes serverTimestamp() to skippedAt and null to completedAt", async () => {
    await markOnboardingSkipped(UID);
    expect(mockSetDoc.mock.calls[0][1]).toEqual({
      onboardingTutorialVersion: TUTORIAL_VERSION,
      onboardingCompletedAt: null,
      onboardingSkippedAt: "SERVER_TS",
    });
  });

  it("is a no-op for an empty uid", async () => {
    await markOnboardingSkipped("");
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("swallows failures", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("nope"));
    await expect(markOnboardingSkipped(UID)).resolves.toBeUndefined();
  });
});

describe("resetOnboarding", () => {
  it("clears localStorage (progress + dismissed) AND nullifies the firestore fields", async () => {
    window.localStorage.setItem(KEY, "anything");
    window.localStorage.setItem(DISMISSED_KEY, "1");
    await resetOnboarding(UID);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull();
    expect(mockSetDoc.mock.calls[0][1]).toEqual({
      onboardingTutorialVersion: null,
      onboardingCompletedAt: null,
      onboardingSkippedAt: null,
    });
  });

  it("is a no-op for an empty uid", async () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem");
    await resetOnboarding("");
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/* ────────────────────────────────────────────
 * Local-dismissed flag (per-device "saw the tour" bit)
 * ──────────────────────────────────────────── */

describe("local dismissed flag", () => {
  it("getLocalDismissed returns false when nothing is stored", () => {
    expect(getLocalDismissed(UID)).toBe(false);
  });

  it("setLocalDismissed writes '1' to the versioned per-user key", () => {
    setLocalDismissed(UID);
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe("1");
    expect(getLocalDismissed(UID)).toBe(true);
  });

  it("clearLocalDismissed removes the key", () => {
    window.localStorage.setItem(DISMISSED_KEY, "1");
    clearLocalDismissed(UID);
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull();
    expect(getLocalDismissed(UID)).toBe(false);
  });

  it("all three are no-ops for an empty uid", () => {
    const spyGet = vi.spyOn(Storage.prototype, "getItem");
    const spySet = vi.spyOn(Storage.prototype, "setItem");
    const spyRemove = vi.spyOn(Storage.prototype, "removeItem");
    expect(getLocalDismissed("")).toBe(false);
    setLocalDismissed("");
    clearLocalDismissed("");
    expect(spyGet).not.toHaveBeenCalled();
    expect(spySet).not.toHaveBeenCalled();
    expect(spyRemove).not.toHaveBeenCalled();
    spyGet.mockRestore();
    spySet.mockRestore();
    spyRemove.mockRestore();
  });

  it("setLocalDismissed swallows storage errors", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setLocalDismissed(UID)).not.toThrow();
    spy.mockRestore();
  });

  it("getLocalDismissed swallows storage errors and returns false", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(getLocalDismissed(UID)).toBe(false);
    spy.mockRestore();
  });

  it("clearLocalDismissed swallows storage errors", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(() => clearLocalDismissed(UID)).not.toThrow();
    spy.mockRestore();
  });
});

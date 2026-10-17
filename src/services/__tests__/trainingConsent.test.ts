import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDoc = vi.hoisted(() => vi.fn());
const mockBatchSet = vi.hoisted(() => vi.fn());
const mockBatchCommit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => (args.slice(1) as string[]).join("/"),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  serverTimestamp: () => "SERVER_TS",
  writeBatch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
}));

vi.mock("../../firebase", () => ({ requireDb: () => ({ name: "db" }) }));

vi.mock("../users", () => ({ PRIVATE_PROFILE_DOC_ID: "profile" }));

import {
  getTrainingConsent,
  isAdultForTraining,
  markTrainingConsentPromptSeen,
  setTrainingConsent,
  shouldPromptTrainingConsent,
  TrainingConsentDeniedError,
  type TrainingConsentState,
} from "../trainingConsent";

const TODAY = new Date(2026, 9, 10);

function consent(overrides: Partial<TrainingConsentState> = {}): TrainingConsentState {
  return {
    optedIn: false,
    policyVersion: null,
    updatedAtMs: null,
    revokedAtMs: null,
    promptSeenAtMs: null,
    dob: "1990-01-01",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCommit.mockResolvedValue(undefined);
});

describe("isAdultForTraining", () => {
  it("fails closed on a missing or impossible birthday", () => {
    expect(isAdultForTraining(null, TODAY)).toBe(false);
    expect(isAdultForTraining("not-a-date", TODAY)).toBe(false);
    expect(isAdultForTraining("2020-02-31", TODAY)).toBe(false);
    expect(isAdultForTraining("2008-10-11", TODAY)).toBe(false);
    expect(isAdultForTraining("2008-10-10", TODAY)).toBe(true);
  });
});

describe("shouldPromptTrainingConsent", () => {
  it("asks once after a first finished game and only for adults who have not opted in", () => {
    expect(shouldPromptTrainingConsent(consent(), 0, TODAY)).toBe(true);
    expect(shouldPromptTrainingConsent(consent(), 1, TODAY)).toBe(true);
    expect(shouldPromptTrainingConsent(consent(), 2, TODAY)).toBe(false);
    expect(shouldPromptTrainingConsent(consent({ optedIn: true }), 0, TODAY)).toBe(false);
    expect(shouldPromptTrainingConsent(consent({ promptSeenAtMs: 1 }), 0, TODAY)).toBe(false);
    expect(shouldPromptTrainingConsent(consent({ dob: "2015-01-01" }), 0, TODAY)).toBe(false);
  });
});

describe("getTrainingConsent", () => {
  it("returns the default when the private profile is missing", async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await getTrainingConsent("u1")).toMatchObject({ optedIn: false, dob: null });
  });

  it("reads the stored fields and ignores junk timestamps", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        trainingConsentOptedIn: true,
        trainingConsentPolicyVersion: "2026-10-10",
        trainingConsentUpdatedAt: { toMillis: () => 10 },
        trainingConsentRevokedAt: { toMillis: () => "no" },
        trainingConsentPromptSeenAt: { toMillis: "nope" },
        dob: "1990-01-01",
      }),
    });
    expect(await getTrainingConsent("u1")).toEqual({
      optedIn: true,
      policyVersion: "2026-10-10",
      updatedAtMs: 10,
      revokedAtMs: null,
      promptSeenAtMs: null,
      dob: "1990-01-01",
    });

    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        trainingConsentOptedIn: "yes",
        trainingConsentPolicyVersion: 3,
        trainingConsentUpdatedAt: 4,
        dob: 5,
      }),
    });
    expect(await getTrainingConsent("u1")).toMatchObject({
      optedIn: false,
      policyVersion: null,
      updatedAtMs: null,
      dob: null,
    });
  });
});

describe("setTrainingConsent", () => {
  it("refuses players under 18", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ dob: "2015-01-01", trainingConsentOptedIn: false }),
    });
    await expect(setTrainingConsent("u1", true)).rejects.toBeInstanceOf(TrainingConsentDeniedError);
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it("writes the profile and a revocation only when turning the setting off", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ dob: "1990-01-01", trainingConsentOptedIn: false }),
    });
    await setTrainingConsent("u1", true);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchSet.mock.calls[0]?.[1]).toMatchObject({
      trainingConsentOptedIn: true,
      trainingConsentPolicyVersion: "2026-10-10",
      trainingConsentUpdatedAt: "SERVER_TS",
      trainingConsentRevokedAt: null,
    });
    expect(mockBatchCommit).toHaveBeenCalledOnce();

    mockBatchSet.mockClear();
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ dob: "1990-01-01", trainingConsentOptedIn: true }),
    });
    await setTrainingConsent("u1", false);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchSet.mock.calls[1]?.[0]).toBe("trainingRevocations/u1");

    mockBatchSet.mockClear();
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ dob: "1990-01-01", trainingConsentOptedIn: false }),
    });
    await setTrainingConsent("u1", false);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
  });
});

describe("markTrainingConsentPromptSeen", () => {
  it("stamps the seen time without changing the opt-in", async () => {
    await markTrainingConsentPromptSeen("u1");
    expect(mockBatchSet).toHaveBeenCalledWith(
      "users/u1/private/profile",
      { trainingConsentPromptSeenAt: "SERVER_TS" },
      { merge: true },
    );
  });
});

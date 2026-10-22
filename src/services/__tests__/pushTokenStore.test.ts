import { describe, it, expect, vi, beforeEach } from "vitest";
import { firestoreNotifMocks } from "../../__tests__/harness/firestoreNotifMock";

const { setDoc: mockSetDoc, getDoc: mockGetDoc } = firestoreNotifMocks;

vi.mock(
  "firebase/firestore",
  async () => (await import("../../__tests__/harness/firestoreNotifMock")).notifFirestoreModule,
);
vi.mock("../users", () => ({ PRIVATE_PROFILE_DOC_ID: "profile" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "web" } }));

import { cappedTokenList, MAX_PUSH_TOKENS, storePushToken } from "../pushTokenStore";

const db = {} as Parameters<typeof storePushToken>[0];
const full = Array.from({ length: 10 }, (_, i) => `old-${i}`);

function seed(docs: Record<string, Record<string, unknown> | undefined>) {
  mockGetDoc.mockImplementation(async (ref: unknown) => ({ data: () => docs[ref as string] }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDoc.mockImplementation(() => Promise.resolve({ data: () => undefined }));
});

describe("cappedTokenList", () => {
  it("matches the 10-entry caps in firestore.rules", () => {
    expect(MAX_PUSH_TOKENS).toBe(10);
  });

  it("leaves room-to-spare and already-present cases to arrayUnion", () => {
    expect(cappedTokenList(undefined, "t")).toBeNull();
    expect(cappedTokenList("not-a-list", "t")).toBeNull();
    expect(cappedTokenList(["a", "b"], "t")).toBeNull();
    expect(cappedTokenList(full.slice(0, 9), "t")).toBeNull();
    expect(cappedTokenList(full, "old-3")).toBeNull();
  });

  it("keeps the newest 9 plus the new token, ignoring junk entries", () => {
    expect(cappedTokenList(full, "new")).toEqual([...full.slice(1), "new"]);
    expect(cappedTokenList([...full, "old-10", 42], "new")).toEqual([...full.slice(2), "old-10", "new"]);
  });
});

describe("storePushToken", () => {
  it("uses arrayUnion with room to spare, private doc first", async () => {
    await storePushToken(db, "u1", "tok");
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      1,
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayUnion", value: "tok" } },
      { merge: true },
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      2,
      "pushTargets/u1",
      { tokens: { _op: "arrayUnion", value: "tok" }, platforms: { tok: "web" }, updatedAt: "SERVER_TS" },
      { merge: true },
    );
  });

  it("trims both docs at the cap and drops the removed tokens' tags", async () => {
    seed({
      "users/u1/private/profile": { fcmTokens: full },
      "pushTargets/u1": { tokens: full, platforms: { "old-0": "ios", "old-1": "web" } },
    });
    await storePushToken(db, "u1", "new");
    const kept = [...full.slice(1), "new"];
    expect(mockSetDoc).toHaveBeenNthCalledWith(1, "users/u1/private/profile", { fcmTokens: kept }, { merge: true });
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      2,
      "pushTargets/u1",
      { tokens: kept, platforms: { new: "web", "old-0": "DELETE_FIELD" }, updatedAt: "SERVER_TS" },
      { merge: true },
    );
  });

  it("re-registering a token already in a full list stays an arrayUnion", async () => {
    seed({ "users/u1/private/profile": { fcmTokens: full }, "pushTargets/u1": { tokens: full } });
    await storePushToken(db, "u1", "old-4");
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      1,
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayUnion", value: "old-4" } },
      { merge: true },
    );
    expect(mockSetDoc.mock.calls[1][1]).toMatchObject({ tokens: { _op: "arrayUnion", value: "old-4" } });
  });

  it("does not touch the mirror when the private write fails", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(storePushToken(db, "u1", "tok")).rejects.toThrow("permission-denied");
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });
});

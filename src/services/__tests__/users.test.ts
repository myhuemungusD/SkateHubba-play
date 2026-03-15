import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const { mockGetDoc, mockSetDoc, mockRunTransaction, mockDoc, mockServerTimestamp } = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockSetDoc: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockDoc: vi.fn((_db: unknown, ...pathSegments: string[]) => pathSegments.join("/")),
  mockServerTimestamp: vi.fn(() => "SERVER_TS"),
}));

vi.mock("firebase/firestore", () => ({
  doc: mockDoc,
  getDoc: mockGetDoc,
  setDoc: mockSetDoc,
  runTransaction: mockRunTransaction,
  serverTimestamp: () => mockServerTimestamp(),
}));

vi.mock("../../firebase");

import {
  getUserProfile,
  isUsernameAvailable,
  createProfile,
  getUidByUsername,
  deleteUserData,
} from "../users";

beforeEach(() => vi.clearAllMocks());

/* ── Tests ──────────────────────────────────── */

describe("users service", () => {
  describe("getUserProfile", () => {
    it("returns profile data when document exists", async () => {
      const profile = { uid: "u1", email: "a@b.com", username: "sk8r" };
      mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
      const result = await getUserProfile("u1");
      expect(result).toEqual(profile);
    });

    it("returns null when document doesn't exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      const result = await getUserProfile("u1");
      expect(result).toBeNull();
    });
  });

  describe("isUsernameAvailable", () => {
    it("returns true when username doc does not exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      expect(await isUsernameAvailable("sk8r")).toBe(true);
    });

    it("returns false when username doc exists", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => true });
      expect(await isUsernameAvailable("sk8r")).toBe(false);
    });

    it("returns false for usernames shorter than 3 chars", async () => {
      expect(await isUsernameAvailable("ab")).toBe(false);
    });

    it("returns false for usernames longer than 20 chars", async () => {
      expect(await isUsernameAvailable("a".repeat(21))).toBe(false);
    });

    it("returns false for usernames with invalid characters", async () => {
      expect(await isUsernameAvailable("sk8r!")).toBe(false);
      expect(await isUsernameAvailable("no spaces")).toBe(false);
    });

    it("normalizes to lowercase", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      await isUsernameAvailable("SK8R");
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "usernames", "sk8r");
    });
  });

  describe("createProfile", () => {
    it("runs a transaction that reserves the username and creates the profile", async () => {
      const profileData = {
        uid: "u1",
        email: "a@b.com",
        username: "sk8r",
        stance: "regular",
        createdAt: "SERVER_TS",
        emailVerified: false,
      };

      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => false }),
          set: vi.fn(),
        };
        return fn(tx);
      });

      const result = await createProfile("u1", "a@b.com", "SK8R", "regular");
      expect(result).toMatchObject({
        uid: "u1",
        email: "a@b.com",
        username: "sk8r",
        stance: "regular",
      });
    });

    it("throws when username is already taken", async () => {
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => {
        const tx = {
          get: vi.fn().mockResolvedValue({ exists: () => true }),
          set: vi.fn(),
        };
        return fn(tx);
      });

      await expect(createProfile("u1", "a@b.com", "sk8r", "regular")).rejects.toThrow(
        "Username is already taken"
      );
    });
  });

  describe("deleteUserData", () => {
    it("runs a transaction that deletes user and username docs", async () => {
      const mockTx = { delete: vi.fn() };
      mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: Function) => fn(mockTx));

      await deleteUserData("u1", "sk8r");

      expect(mockRunTransaction).toHaveBeenCalled();
      expect(mockTx.delete).toHaveBeenCalledTimes(2);
    });

    it("re-throws transaction errors", async () => {
      mockRunTransaction.mockRejectedValueOnce(new Error("Transaction failed"));
      await expect(deleteUserData("u1", "sk8r")).rejects.toThrow("Transaction failed");
    });
  });

  describe("getUidByUsername", () => {
    it("returns uid when username exists", async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ uid: "u1" }),
      });
      expect(await getUidByUsername("sk8r")).toBe("u1");
    });

    it("returns null when username doesn't exist", async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      expect(await getUidByUsername("sk8r")).toBeNull();
    });
  });
});

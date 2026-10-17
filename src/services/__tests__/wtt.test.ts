import { describe, it, expect, vi, beforeEach } from "vitest";
import * as wtt from "../wtt";

const mockDb = {
  collection: vi.fn(),
};

const mockAuth = {
  currentUser: { uid: "test-uid" },
};

vi.mock("../../firebase", () => ({
  requireDb: () => mockDb,
  requireAuth: () => mockAuth,
}));

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return {
    ...actual,
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    query: vi.fn((...args: unknown[]) => ({ queryArgs: args })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    orderBy: vi.fn((field: string) => ({ orderBy: field })),
    limit: vi.fn((n: number) => ({ limit: n })),
    getDocs: vi.fn(() =>
      Promise.resolve({
        docs: [],
      }),
    ),
    doc: vi.fn((_db: unknown, path: string, id: string) => ({ path, id })),
    setDoc: vi.fn(() => Promise.resolve()),
    getDoc: vi.fn(() =>
      Promise.resolve({
        exists: () => false,
      }),
    ),
    onSnapshot: vi.fn(() => vi.fn()),
    serverTimestamp: vi.fn(() => "SERVER_TIMESTAMP"),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchWttItems", () => {
  it("returns empty array when no items found", async () => {
    const result = await wtt.fetchWttItems("user123", 10);
    expect(result).toEqual([]);
  });
});

describe("fetchWttReliability", () => {
  it("returns null when doc does not exist", async () => {
    const result = await wtt.fetchWttReliability("user123");
    expect(result).toBeNull();
  });
});

describe("subscribeToWttReliability", () => {
  it("returns an unsubscribe function", () => {
    const callback = vi.fn();
    const unsubscribe = wtt.subscribeToWttReliability("user123", callback);
    expect(typeof unsubscribe).toBe("function");
  });
});

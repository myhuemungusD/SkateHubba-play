import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ────────────────── */
const {
  mockAddDoc,
  mockGetDoc,
  mockGetDocs,
  mockUpdateDoc,
  mockRunTransaction,
  mockOnSnapshot,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockLimit,
  mockOrderBy,
  mockTxGet,
  mockTxUpdate,
} = vi.hoisted(() => ({
  mockAddDoc: vi.fn(),
  mockGetDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockRunTransaction: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn((...args: unknown[]) => {
    const path = (args as string[]).slice(1).join("/");
    return { __path: path, id: path.split("/").pop() || "auto-id" };
  }),
  mockCollection: vi.fn((...args: unknown[]) => (args as string[])[1]),
  mockQuery: vi.fn((...args: unknown[]) => args),
  mockWhere: vi.fn((...args: unknown[]) => args),
  mockLimit: vi.fn((...args: unknown[]) => args),
  mockOrderBy: vi.fn((...args: unknown[]) => args),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  addDoc: mockAddDoc,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  updateDoc: mockUpdateDoc,
  runTransaction: mockRunTransaction,
  query: mockQuery,
  where: mockWhere,
  limit: mockLimit,
  orderBy: mockOrderBy,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: () => "SERVER_TS",
  increment: (n: number) => ({ _increment: n }),
}));

vi.mock("../../firebase");

import {
  createSpot,
  getSpotById,
  getAllSpots,
  getSpotsByUser,
  tagGameWithSpot,
  subscribeToSpots,
  subscribeToSpotGames,
  fetchSpotGames,
  updateSpotName,
} from "../spots";

beforeEach(() => {
  vi.clearAllMocks();
  mockRunTransaction.mockImplementation(async (_db: unknown, cb: Function) => {
    const tx = { get: mockTxGet, update: mockTxUpdate, set: vi.fn() };
    return cb(tx);
  });
});

/* ── createSpot ───────────────────────────── */

describe("createSpot", () => {
  it("creates a spot with sanitised name and returns doc id", async () => {
    mockAddDoc.mockResolvedValue({ id: "spot1" });

    const id = await createSpot({
      name: "  Hollywood High 16  ",
      latitude: 34.1,
      longitude: -118.3,
      createdByUid: "u1",
      createdByUsername: "sk8r",
    });

    expect(id).toBe("spot1");
    expect(mockAddDoc).toHaveBeenCalledWith("spots", {
      name: "Hollywood High 16",
      latitude: 34.1,
      longitude: -118.3,
      createdByUid: "u1",
      createdByUsername: "sk8r",
      createdAt: "SERVER_TS",
      gameCount: 0,
    });
  });

  it("rejects empty name", async () => {
    await expect(
      createSpot({ name: "   ", latitude: 34, longitude: -118, createdByUid: "u1", createdByUsername: "sk8r" }),
    ).rejects.toThrow("Spot name cannot be empty");
  });

  it("rejects invalid latitude", async () => {
    await expect(
      createSpot({ name: "Spot", latitude: 91, longitude: -118, createdByUid: "u1", createdByUsername: "sk8r" }),
    ).rejects.toThrow("Invalid latitude");
  });

  it("rejects invalid longitude", async () => {
    await expect(
      createSpot({ name: "Spot", latitude: 34, longitude: 181, createdByUid: "u1", createdByUsername: "sk8r" }),
    ).rejects.toThrow("Invalid longitude");
  });
});

/* ── getSpotById ──────────────────────────── */

describe("getSpotById", () => {
  it("returns spot when found", async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: "spot1",
      data: () => ({
        name: "Hollywood",
        latitude: 34.1,
        longitude: -118.3,
        createdByUid: "u1",
        createdByUsername: "sk8r",
        createdAt: null,
        gameCount: 5,
      }),
    });

    const spot = await getSpotById("spot1");
    expect(spot).not.toBeNull();
    expect(spot!.name).toBe("Hollywood");
    expect(spot!.id).toBe("spot1");
  });

  it("returns null when not found", async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    const spot = await getSpotById("missing");
    expect(spot).toBeNull();
  });

  it("throws on malformed spot document", async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: "bad",
      data: () => ({ name: 123 }), // name is not a string
    });

    await expect(getSpotById("bad")).rejects.toThrow("Malformed spot document");
  });
});

/* ── getAllSpots ───────────────────────────── */

describe("getAllSpots", () => {
  it("returns all spots ordered by gameCount", async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: "s1",
          data: () => ({
            name: "Spot A",
            latitude: 34,
            longitude: -118,
            createdByUid: "u1",
            createdByUsername: "sk8r",
            createdAt: null,
            gameCount: 10,
          }),
        },
        {
          id: "s2",
          data: () => ({
            name: "Spot B",
            latitude: 35,
            longitude: -117,
            createdByUid: "u2",
            createdByUsername: "rival",
            createdAt: null,
            gameCount: 3,
          }),
        },
      ],
    });

    const spots = await getAllSpots();
    expect(spots).toHaveLength(2);
    expect(spots[0].name).toBe("Spot A");
    expect(spots[1].name).toBe("Spot B");
  });
});

/* ── getSpotsByUser ───────────────────────── */

describe("getSpotsByUser", () => {
  it("queries spots by createdByUid and returns results", async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: "s1",
          data: () => ({
            name: "My Spot",
            latitude: 34,
            longitude: -118,
            createdByUid: "u1",
            createdByUsername: "sk8r",
            createdAt: null,
            gameCount: 2,
          }),
        },
      ],
    });

    const spots = await getSpotsByUser("u1");
    expect(mockWhere).toHaveBeenCalledWith("createdByUid", "==", "u1");
    expect(spots).toHaveLength(1);
    expect(spots[0].name).toBe("My Spot");
  });
});

/* ── tagGameWithSpot ──────────────────────── */

describe("tagGameWithSpot", () => {
  it("tags a game with a spot in a transaction", async () => {
    mockTxGet
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          player1Uid: "u1",
          player2Uid: "u2",
          status: "complete",
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ name: "Hollywood" }),
      });

    await tagGameWithSpot("game1", "spot1", "u1");

    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects if game is already tagged", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        player1Uid: "u1",
        player2Uid: "u2",
        status: "complete",
        spotId: "existing",
      }),
    });

    await expect(tagGameWithSpot("game1", "spot1", "u1")).rejects.toThrow("already tagged");
  });

  it("rejects if user is not a participant", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        player1Uid: "u1",
        player2Uid: "u2",
        status: "complete",
      }),
    });

    await expect(tagGameWithSpot("game1", "spot1", "u3")).rejects.toThrow("Only game participants");
  });

  it("rejects if game is still active", async () => {
    mockTxGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        player1Uid: "u1",
        player2Uid: "u2",
        status: "active",
      }),
    });

    await expect(tagGameWithSpot("game1", "spot1", "u1")).rejects.toThrow("Cannot tag an active game");
  });

  it("rejects if game not found", async () => {
    mockTxGet.mockResolvedValueOnce({ exists: () => false });

    await expect(tagGameWithSpot("game1", "spot1", "u1")).rejects.toThrow("Game not found");
  });

  it("rejects if spot not found", async () => {
    mockTxGet
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          player1Uid: "u1",
          player2Uid: "u2",
          status: "complete",
        }),
      })
      .mockResolvedValueOnce({ exists: () => false });

    await expect(tagGameWithSpot("game1", "spot1", "u1")).rejects.toThrow("Spot not found");
  });
});

/* ── subscribeToSpots ─────────────────────── */

describe("subscribeToSpots", () => {
  it("subscribes and calls onUpdate with spots", () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockImplementation((_q: unknown, onNext: Function) => {
      onNext({
        docs: [
          {
            id: "s1",
            data: () => ({
              name: "Spot A",
              latitude: 34,
              longitude: -118,
              createdByUid: "u1",
              createdByUsername: "sk8r",
              createdAt: null,
              gameCount: 5,
            }),
          },
        ],
      });
      return unsub;
    });

    const onUpdate = vi.fn();
    const result = subscribeToSpots(onUpdate);

    expect(mockOnSnapshot).toHaveBeenCalled();
    expect(result).toBe(unsub);
    expect(onUpdate).toHaveBeenCalledWith([
      expect.objectContaining({ id: "s1", name: "Spot A" }),
    ]);
  });

  it("handles error callback", () => {
    mockOnSnapshot.mockImplementation((_q: unknown, _onNext: Function, onError: Function) => {
      onError(new Error("subscription error"));
      return vi.fn();
    });

    const onUpdate = vi.fn();
    subscribeToSpots(onUpdate);

    expect(onUpdate).not.toHaveBeenCalled();
  });
});

/* ── subscribeToSpotGames ─────────────────── */

describe("subscribeToSpotGames", () => {
  it("subscribes to games at a specific spot and calls onUpdate", () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockImplementation((_q: unknown, onNext: Function) => {
      onNext({
        docs: [
          {
            id: "g1",
            data: () => ({ player1Username: "sk8r", status: "complete" }),
          },
        ],
      });
      return unsub;
    });

    const onUpdate = vi.fn();
    const result = subscribeToSpotGames("spot1", onUpdate);

    expect(mockOnSnapshot).toHaveBeenCalled();
    expect(result).toBe(unsub);
    expect(onUpdate).toHaveBeenCalledWith([
      expect.objectContaining({ id: "g1", player1Username: "sk8r" }),
    ]);
  });

  it("handles error callback", () => {
    mockOnSnapshot.mockImplementation((_q: unknown, _onNext: Function, onError: Function) => {
      onError(new Error("spot games error"));
      return vi.fn();
    });

    const onUpdate = vi.fn();
    subscribeToSpotGames("spot1", onUpdate);

    expect(onUpdate).not.toHaveBeenCalled();
  });
});

/* ── fetchSpotGames ───────────────────────── */

describe("fetchSpotGames", () => {
  it("fetches games tagged at a spot", async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: "g1",
          data: () => ({
            player1Username: "sk8r",
            player2Username: "rival",
            status: "complete",
          }),
        },
      ],
    });

    const games = await fetchSpotGames("spot1");
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe("g1");
  });
});

/* ── updateSpotName ───────────────────────── */

describe("updateSpotName", () => {
  it("updates a spot name", async () => {
    await updateSpotName("spot1", "New Name");
    expect(mockUpdateDoc).toHaveBeenCalled();
  });

  it("rejects empty name", async () => {
    await expect(updateSpotName("spot1", "   ")).rejects.toThrow("Spot name cannot be empty");
  });
});

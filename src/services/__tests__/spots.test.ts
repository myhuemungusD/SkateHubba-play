import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ──────────────────
 * Mirrors the games.test.ts pattern: each Firestore SDK function is a
 * hoisted vi.fn() so we can assert exactly what the spots service calls
 * without spinning up a real emulator. The shape stubs (doc/collection/
 * query/etc) just record their arguments and return them as opaque tokens.
 */
const {
  mockAddDoc,
  mockSetDoc,
  mockGetDoc,
  mockGetDocs,
  mockRunTransaction,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockLimit,
  mockOrderBy,
  mockTxGet,
  mockTxSet,
} = vi.hoisted(() => ({
  mockAddDoc: vi.fn(),
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockDoc: vi.fn((...args: unknown[]) => {
    // Last arg can be omitted (for doc(collectionRef) → auto id) — emit a
    // stable fake id in that case so callers can read .id without crashing.
    const segments = args.slice(1).filter((s) => typeof s === "string");
    const path = segments.join("/");
    return { __path: path, id: segments.length > 0 ? segments[segments.length - 1] : "auto-id" };
  }),
  mockCollection: vi.fn((...args: unknown[]) => ({ __collection: args.slice(1).join("/") })),
  mockQuery: vi.fn((...args: unknown[]) => args),
  mockWhere: vi.fn((field: unknown, op: unknown, value: unknown) => ({ __where: { field, op, value } })),
  mockLimit: vi.fn((n: unknown) => ({ __limit: n })),
  mockOrderBy: vi.fn((field: unknown, dir: unknown) => ({ __orderBy: { field, dir } })),
  mockTxGet: vi.fn(),
  mockTxSet: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: mockCollection,
  doc: mockDoc,
  addDoc: mockAddDoc,
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  getDocs: mockGetDocs,
  runTransaction: mockRunTransaction,
  query: mockQuery,
  where: mockWhere,
  limit: mockLimit,
  orderBy: mockOrderBy,
  serverTimestamp: () => "SERVER_TS",
}));

/**
 * Mimics a Firestore Timestamp via structural duck-typing — the real
 * service uses `.toDate()` rather than `instanceof Timestamp` so the
 * SDK class identity doesn't matter.
 */
class FakeTimestamp {
  constructor(private readonly date: Date) {}
  toDate() {
    return this.date;
  }
}

vi.mock("../../firebase");

const mockSentry = vi.fn();
// Stub the entire sentry module — partial mocks would leave logger.ts
// (which imports addBreadcrumb from the same module) reaching for an
// undefined export.
vi.mock("../../lib/sentry", () => ({
  captureException: (...args: unknown[]) => mockSentry(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  setUser: vi.fn(),
  initSentry: vi.fn(),
}));

import {
  createSpot,
  getSpot,
  getSpotComments,
  getSpotsInBounds,
  fetchSpotName,
  addSpotComment,
  _resetCreateSpotRateLimit,
} from "../spots";
import type { CreateSpotRequest } from "../../types/spot";

const VALID_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "22222222-3333-4444-5555-666666666666";

const sampleTimestamp = new FakeTimestamp(new Date("2026-04-10T00:00:00Z"));

function makeSpotSnap(overrides: Record<string, unknown> = {}, id = VALID_ID) {
  return {
    exists: () => true,
    id,
    data: () => ({
      createdBy: "creator-uid",
      name: "Hollenbeck Hubba",
      description: "smooth ledge into bank",
      latitude: 34.0522,
      longitude: -118.2437,
      gnarRating: 3,
      bustRisk: 2,
      obstacles: ["ledge", "hubba"],
      photoUrls: ["https://example.com/p.jpg"],
      isVerified: false,
      isActive: true,
      createdAt: sampleTimestamp,
      updatedAt: sampleTimestamp,
      ...overrides,
    }),
  };
}

function makeMissingSnap() {
  return { exists: () => false };
}

function makeQuerySnap(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  return { docs };
}

const validRequest: CreateSpotRequest = {
  name: "Hollenbeck Hubba",
  description: "smooth ledge into bank",
  latitude: 34.0522,
  longitude: -118.2437,
  gnarRating: 3,
  bustRisk: 2,
  obstacles: ["ledge", "hubba"],
  photoUrls: ["https://example.com/p.jpg"],
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetCreateSpotRateLimit();
});

/* ────────────────────────────────────────────
 * createSpot
 * ──────────────────────────────────────────── */

describe("createSpot", () => {
  it("writes a valid spot and returns the optimistic local copy", async () => {
    mockAddDoc.mockResolvedValueOnce({ id: "new-spot-id" });

    const spot = await createSpot(validRequest, "creator-uid");

    expect(spot.id).toBe("new-spot-id");
    expect(spot.createdBy).toBe("creator-uid");
    expect(spot.name).toBe("Hollenbeck Hubba");
    expect(spot.isVerified).toBe(false);
    expect(spot.isActive).toBe(true);

    // First addDoc call is the spot write
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.createdBy).toBe("creator-uid");
    expect(payload.isVerified).toBe(false);
    expect(payload.isActive).toBe(true);
    expect(payload.createdAt).toBe("SERVER_TS");
    expect(payload.updatedAt).toBe("SERVER_TS");
  });

  it("trims the name and description before writing", async () => {
    mockAddDoc.mockResolvedValueOnce({ id: "g1" });
    await createSpot({ ...validRequest, name: "  Hubba  ", description: "  ledge  " }, "creator-uid");
    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.name).toBe("Hubba");
    expect(payload.description).toBe("ledge");
  });

  it("normalizes a missing description to null", async () => {
    mockAddDoc.mockResolvedValueOnce({ id: "g1" });
    await createSpot({ ...validRequest, description: undefined }, "creator-uid");
    const payload = mockAddDoc.mock.calls[0][1];
    expect(payload.description).toBeNull();
  });

  it("rate-limits a second create within the cooldown window", async () => {
    mockAddDoc.mockResolvedValueOnce({ id: "g1" });
    await createSpot(validRequest, "creator-uid");
    await expect(createSpot(validRequest, "creator-uid")).rejects.toThrow(/wait/);
  });

  it("writes a best-effort lastSpotCreatedAt on the user doc", async () => {
    mockAddDoc.mockResolvedValueOnce({ id: "g1" });
    await createSpot(validRequest, "creator-uid");
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][1]).toEqual({ lastSpotCreatedAt: "SERVER_TS" });
  });

  it("still resolves successfully if the rate-limit timestamp write fails", async () => {
    mockAddDoc.mockResolvedValueOnce({ id: "g1" });
    mockSetDoc.mockRejectedValueOnce(new Error("write failed"));
    const spot = await createSpot(validRequest, "creator-uid");
    expect(spot.id).toBe("g1");
  });

  it("rejects an empty name", async () => {
    await expect(createSpot({ ...validRequest, name: "  " }, "u")).rejects.toThrow(/required/);
  });

  it("rejects a name longer than 80 characters", async () => {
    await expect(createSpot({ ...validRequest, name: "x".repeat(81) }, "u")).rejects.toThrow(/80/);
  });

  it("rejects a description longer than 500 characters", async () => {
    await expect(createSpot({ ...validRequest, description: "y".repeat(501) }, "u")).rejects.toThrow(/500/);
  });

  it("rejects out-of-range latitude", async () => {
    await expect(createSpot({ ...validRequest, latitude: 91 }, "u")).rejects.toThrow(/latitude/);
    await expect(createSpot({ ...validRequest, latitude: -91 }, "u")).rejects.toThrow(/latitude/);
  });

  it("rejects out-of-range longitude", async () => {
    await expect(createSpot({ ...validRequest, longitude: 181 }, "u")).rejects.toThrow(/longitude/);
    await expect(createSpot({ ...validRequest, longitude: -181 }, "u")).rejects.toThrow(/longitude/);
  });

  it("rejects ratings outside 1-5", async () => {
    await expect(createSpot({ ...validRequest, gnarRating: 0 as 1 }, "u")).rejects.toThrow(/gnar/);
    await expect(createSpot({ ...validRequest, bustRisk: 6 as 5 }, "u")).rejects.toThrow(/bust/);
  });

  it("rejects unknown obstacle types", async () => {
    await expect(createSpot({ ...validRequest, obstacles: ["not_a_real_obstacle"] as never }, "u")).rejects.toThrow(
      /obstacles/,
    );
  });

  it("rejects more than 5 photo urls", async () => {
    const photoUrls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.jpg`);
    await expect(createSpot({ ...validRequest, photoUrls }, "u")).rejects.toThrow(/max 5/);
  });

  it("rejects non-https photo urls", async () => {
    await expect(createSpot({ ...validRequest, photoUrls: ["http://example.com/p.jpg"] }, "u")).rejects.toThrow(
      /https/,
    );
  });

  it("rejects malformed photo url strings", async () => {
    // Hits the URL parser catch branch in isValidPhotoUrl — a string that
    // can't be constructed into a URL at all.
    await expect(createSpot({ ...validRequest, photoUrls: ["not a url"] }, "u")).rejects.toThrow(/https/);
  });

  it("rejects a photoUrls field that isn't an array", async () => {
    await expect(createSpot({ ...validRequest, photoUrls: "https://x" as unknown as string[] }, "u")).rejects.toThrow(
      /array/,
    );
  });

  it("rejects a non-array obstacles field", async () => {
    await expect(createSpot({ ...validRequest, obstacles: "ledge" as unknown as never }, "u")).rejects.toThrow(
      /obstacles/,
    );
  });

  it("rejects a non-string description", async () => {
    await expect(createSpot({ ...validRequest, description: 123 as unknown as string }, "u")).rejects.toThrow(
      /description must be a string/,
    );
  });

  it("rejects a non-string photo url entry", async () => {
    await expect(createSpot({ ...validRequest, photoUrls: [123 as unknown as string] }, "u")).rejects.toThrow(/https/);
  });
});

/* ────────────────────────────────────────────
 * getSpot
 * ──────────────────────────────────────────── */

describe("getSpot", () => {
  it("returns a parsed spot for an active doc", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap());
    const spot = await getSpot(VALID_ID);
    expect(spot).not.toBeNull();
    expect(spot?.id).toBe(VALID_ID);
    expect(spot?.name).toBe("Hollenbeck Hubba");
    expect(spot?.createdAt).toBe("2026-04-10T00:00:00.000Z");
  });

  it("returns null for a non-UUID id without hitting Firestore", async () => {
    expect(await getSpot("not-a-uuid")).toBeNull();
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("returns null for a non-existent doc", async () => {
    mockGetDoc.mockResolvedValueOnce(makeMissingSnap());
    expect(await getSpot(VALID_ID)).toBeNull();
  });

  it("filters out inactive spots even if they exist", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ isActive: false }));
    expect(await getSpot(VALID_ID)).toBeNull();
  });

  it("returns null and pages Sentry on Firestore errors", async () => {
    mockGetDoc.mockRejectedValueOnce(new Error("permission-denied"));
    expect(await getSpot(VALID_ID)).toBeNull();
    expect(mockSentry).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { op: "getSpot" } }));
  });

  it("recovers when an inert string field comes back malformed", async () => {
    // createdBy missing → toSpot throws → catch path returns null + Sentry
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: VALID_ID,
      data: () => ({ name: "x" }), // missing required fields
    });
    expect(await getSpot(VALID_ID)).toBeNull();
    expect(mockSentry).toHaveBeenCalled();
  });

  it("falls back to a current ISO string when timestamps haven't resolved yet", async () => {
    // Fresh writes can return a sentinel before serverTimestamp resolves —
    // the parser must not crash and must produce a valid ISO string. We
    // assert format rather than exact value because the fallback is
    // wall-clock dependent.
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ createdAt: null, updatedAt: undefined }));
    const spot = await getSpot(VALID_ID);
    expect(spot).not.toBeNull();
    expect(spot?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(spot?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes a missing/non-string description to null", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ description: 42 }));
    const spot = await getSpot(VALID_ID);
    expect(spot?.description).toBeNull();
  });

  it("normalizes a non-array obstacles field to []", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ obstacles: "not-an-array" }));
    const spot = await getSpot(VALID_ID);
    expect(spot?.obstacles).toEqual([]);
  });

  it("normalizes a non-string-array photoUrls field to []", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ photoUrls: [1, 2, 3] }));
    const spot = await getSpot(VALID_ID);
    expect(spot?.photoUrls).toEqual([]);
  });

  it("falls back when a Timestamp-shaped field has a non-function toDate", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ createdAt: { toDate: "not-a-function" } }));
    const spot = await getSpot(VALID_ID);
    expect(spot?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("falls back when toDate returns a non-Date value", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ createdAt: { toDate: () => "2026-04-10" } }));
    const spot = await getSpot(VALID_ID);
    expect(spot?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("falls back when toDate returns an invalid Date", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ createdAt: { toDate: () => new Date("not a real date") } }));
    const spot = await getSpot(VALID_ID);
    expect(spot?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

/* ────────────────────────────────────────────
 * fetchSpotName
 * ──────────────────────────────────────────── */

describe("fetchSpotName", () => {
  it("returns the name of a found spot", async () => {
    mockGetDoc.mockResolvedValueOnce(makeSpotSnap({ name: "Hollenbeck Hubba" }));
    expect(await fetchSpotName(VALID_ID)).toBe("Hollenbeck Hubba");
  });

  it("returns null for a missing spot", async () => {
    mockGetDoc.mockResolvedValueOnce(makeMissingSnap());
    expect(await fetchSpotName(VALID_ID)).toBeNull();
  });

  it("returns null without calling Firestore when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await fetchSpotName(VALID_ID, controller.signal)).toBeNull();
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it("returns null when the signal is aborted while the fetch is in flight", async () => {
    const controller = new AbortController();
    let resolveFetch: (value: unknown) => void = () => {};
    mockGetDoc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const promise = fetchSpotName(VALID_ID, controller.signal);
    controller.abort();
    resolveFetch(makeSpotSnap());
    expect(await promise).toBeNull();
  });
});

/* ────────────────────────────────────────────
 * getSpotsInBounds
 * ──────────────────────────────────────────── */

describe("getSpotsInBounds", () => {
  it("queries the spots collection with the isActive filter and latitude range", async () => {
    mockGetDocs.mockResolvedValueOnce(makeQuerySnap([]));
    await getSpotsInBounds({ north: 34.1, south: 34.0, east: -118.2, west: -118.3 });
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    // The query needs an isActive equality filter (so the read rule is
    // satisfiable at query time) plus the latitude range bounds.
    const whereCalls = mockWhere.mock.calls;
    expect(whereCalls.some((c) => c[0] === "isActive" && c[1] === "==" && c[2] === true)).toBe(true);
    expect(whereCalls.some((c) => c[0] === "latitude" && c[1] === ">=" && c[2] === 34.0)).toBe(true);
    expect(whereCalls.some((c) => c[0] === "latitude" && c[1] === "<=" && c[2] === 34.1)).toBe(true);
    expect(mockOrderBy).toHaveBeenCalledWith("latitude");
    expect(mockLimit).toHaveBeenCalledWith(500);
  });

  it("filters out spots outside the longitude bounds (latitude is server-side)", async () => {
    // The Firestore query handles isActive + latitude server-side; only the
    // longitude check happens in the client. The mock simulates a query
    // result that has already been pre-filtered by the server.
    mockGetDocs.mockResolvedValueOnce(
      makeQuerySnap([
        // In longitude bounds → kept
        { ...makeSpotSnap({}, "in-bounds"), id: "in-bounds" },
        // East of bounds → dropped
        { ...makeSpotSnap({ longitude: -118.0 }, "too-east"), id: "too-east" },
        // West of bounds → dropped
        { ...makeSpotSnap({ longitude: -118.5 }, "too-west"), id: "too-west" },
      ]),
    );

    const spots = await getSpotsInBounds({
      north: 34.1,
      south: 34.0,
      east: -118.2,
      west: -118.3,
    });

    expect(spots).toHaveLength(1);
    expect(spots[0].id).toBe("in-bounds");
  });

  it("skips malformed docs without breaking the result", async () => {
    mockGetDocs.mockResolvedValueOnce(
      makeQuerySnap([makeSpotSnap({}, "good"), { id: "bad", data: () => ({ name: "missing other fields" }) }]),
    );
    const spots = await getSpotsInBounds({
      north: 34.1,
      south: 34.0,
      east: -118.2,
      west: -118.3,
    });
    expect(spots).toHaveLength(1);
    expect(spots[0].id).toBe("good");
  });

  it("rejects malformed bounds", async () => {
    await expect(getSpotsInBounds({ north: 0, south: 1, east: 0, west: 0 })).rejects.toThrow(/Invalid/);
    await expect(getSpotsInBounds({ north: NaN, south: 0, east: 0, west: 0 })).rejects.toThrow(/Invalid/);
  });
});

/* ────────────────────────────────────────────
 * getSpotComments
 * ──────────────────────────────────────────── */

describe("getSpotComments", () => {
  function makeCommentSnap(overrides: Record<string, unknown> = {}, id = "c1") {
    return {
      id,
      data: () => ({
        userId: "commenter",
        content: "good spot",
        createdAt: sampleTimestamp,
        ...overrides,
      }),
    };
  }

  it("returns parsed comments in order", async () => {
    mockGetDocs.mockResolvedValueOnce(makeQuerySnap([makeCommentSnap({}, "c1"), makeCommentSnap({}, "c2")]));
    const comments = await getSpotComments(VALID_ID);
    expect(comments).toHaveLength(2);
    expect(comments[0].userId).toBe("commenter");
    expect(comments[0].spotId).toBe(VALID_ID);
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockLimit).toHaveBeenCalledWith(50);
  });

  it("returns [] for a non-UUID spot id", async () => {
    expect(await getSpotComments("garbled")).toEqual([]);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("skips malformed comment docs", async () => {
    mockGetDocs.mockResolvedValueOnce(
      makeQuerySnap([makeCommentSnap({}, "good"), { id: "bad", data: () => ({ content: "missing userId" }) }]),
    );
    const comments = await getSpotComments(VALID_ID);
    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe("good");
  });
});

/* ────────────────────────────────────────────
 * addSpotComment
 * ──────────────────────────────────────────── */

describe("addSpotComment", () => {
  beforeEach(() => {
    mockRunTransaction.mockImplementation(async (_db: unknown, cb: Function) => {
      const tx = { get: mockTxGet, set: mockTxSet };
      return cb(tx);
    });
  });

  it("writes a comment when the parent spot exists", async () => {
    mockTxGet.mockResolvedValueOnce(makeSpotSnap());
    const comment = await addSpotComment(VALID_ID, "good spot", "commenter-uid");
    expect(comment.spotId).toBe(VALID_ID);
    expect(comment.userId).toBe("commenter-uid");
    expect(comment.content).toBe("good spot");
    expect(mockTxSet).toHaveBeenCalledTimes(1);
    expect(mockTxSet.mock.calls[0][1]).toEqual({
      userId: "commenter-uid",
      content: "good spot",
      createdAt: "SERVER_TS",
    });
  });

  it("throws if the parent spot is missing", async () => {
    mockTxGet.mockResolvedValueOnce(makeMissingSnap());
    await expect(addSpotComment(VALID_ID, "good spot", "u")).rejects.toThrow(/not found/);
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("trims the content and rejects empty comments", async () => {
    await expect(addSpotComment(VALID_ID, "   ", "u")).rejects.toThrow(/empty/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("rejects content longer than 300 characters", async () => {
    await expect(addSpotComment(VALID_ID, "x".repeat(301), "u")).rejects.toThrow(/300/);
  });

  it("rejects a non-UUID spot id without touching Firestore", async () => {
    await expect(addSpotComment("garbled", "ok", "u")).rejects.toThrow(/Invalid/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("forwards spotId verbatim through the transaction", async () => {
    mockTxGet.mockResolvedValueOnce(makeSpotSnap({}, OTHER_ID));
    const comment = await addSpotComment(OTHER_ID, "great", "commenter");
    expect(comment.spotId).toBe(OTHER_ID);
  });
});

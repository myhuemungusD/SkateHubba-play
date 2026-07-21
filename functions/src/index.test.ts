import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Trigger-dispatch coverage for the `onGameCompleted` handler.
 *
 * The authoritative idempotency + integrity logic lives inside
 * `applyGameStats` (covered exhaustively by applyGameStats.test.ts). The
 * handler in index.ts is the thin pre-check that decides whether to open a
 * transaction at all — untested, an inverted boolean here silently either
 * (a) opens a transaction on every no-op write (billable regression) or
 * (b) skips a real terminal transition (unrecoverable under-count).
 *
 * We capture the handler by mocking `onDocumentUpdated` (which index.ts
 * calls at import time), then drive the fast path directly.
 */

// Captured handler — the callback index.ts hands to onDocumentUpdated.
type Handler = (event: {
  data?: {
    after: { data: () => Record<string, unknown> | undefined };
    before: { data: () => Record<string, unknown> | undefined };
  };
  params: { gameId: string };
}) => Promise<void>;

const captured: {
  handler: Handler | null;
  options: Record<string, unknown> | null;
} = { handler: null, options: null };

const applyGameStatsMock = vi.fn<(db: unknown, gameId: string) => Promise<string>>();
const initializeAppMock = vi.fn();
const getFirestoreMock = vi.fn((dbId: string): { __db: string } => ({ __db: dbId }));

vi.mock("firebase-admin/app", () => ({
  initializeApp: () => initializeAppMock(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: (dbId: string) => getFirestoreMock(dbId),
}));

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentUpdated: (options: Record<string, unknown>, handler: Handler) => {
    captured.options = options;
    captured.handler = handler;
    // The real return value is a CloudFunction; the trigger registration is
    // a side effect — the exported symbol just has to exist.
    return { __registered: true };
  },
}));

vi.mock("./applyGameStats.js", () => ({
  applyGameStats: (db: unknown, gameId: string) => applyGameStatsMock(db, gameId),
}));

const GAME_ID = "game-1";

function event(
  after: Record<string, unknown> | undefined,
  before: Record<string, unknown> = {},
): {
  data?: {
    after: { data: () => Record<string, unknown> | undefined };
    before: { data: () => Record<string, unknown> | undefined };
  };
  params: { gameId: string };
} {
  return {
    data:
      after === undefined
        ? undefined
        : {
            after: { data: () => after },
            before: { data: () => before },
          },
    params: { gameId: GAME_ID },
  };
}

beforeEach(async () => {
  vi.resetModules();
  captured.handler = null;
  captured.options = null;
  applyGameStatsMock.mockReset().mockResolvedValue("applied");
  initializeAppMock.mockReset();
  getFirestoreMock.mockClear();
  // Fresh import wires the trigger, populating `captured`.
  await import("./index.js");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onGameCompleted trigger", () => {
  it("registers against the named database 'skatehubba' in us-central1", () => {
    expect(captured.options).toMatchObject({
      document: "games/{gameId}",
      database: "skatehubba",
      region: "us-central1",
    });
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });

  it("skips when the document was deleted (event.data undefined)", async () => {
    await captured.handler?.(event(undefined));
    expect(applyGameStatsMock).not.toHaveBeenCalled();
  });

  it("skips a still-active game", async () => {
    await captured.handler?.(event({ status: "active", winner: "uid-1" }));
    expect(applyGameStatsMock).not.toHaveBeenCalled();
  });

  it("skips a terminal game with a null winner", async () => {
    await captured.handler?.(event({ status: "complete", winner: null }));
    expect(applyGameStatsMock).not.toHaveBeenCalled();
  });

  it("skips a terminal game with an empty-string winner", async () => {
    await captured.handler?.(event({ status: "complete", winner: "" }));
    expect(applyGameStatsMock).not.toHaveBeenCalled();
  });

  it("skips a terminal game with a non-string winner", async () => {
    await captured.handler?.(event({ status: "complete", winner: 42 }));
    expect(applyGameStatsMock).not.toHaveBeenCalled();
  });

  it("skips when statsApplied is already true (own-write re-entry)", async () => {
    await captured.handler?.(event({ status: "complete", winner: "uid-1", statsApplied: true }));
    expect(applyGameStatsMock).not.toHaveBeenCalled();
  });

  it("dispatches to applyGameStats on a freshly-complete winner-bearing game", async () => {
    await captured.handler?.(event({ status: "complete", winner: "uid-1" }));
    expect(getFirestoreMock).toHaveBeenCalledWith("skatehubba");
    expect(applyGameStatsMock).toHaveBeenCalledTimes(1);
    expect(applyGameStatsMock).toHaveBeenCalledWith({ __db: "skatehubba" }, GAME_ID);
  });

  it("dispatches to applyGameStats on a forfeit with a valid winner", async () => {
    await captured.handler?.(event({ status: "forfeit", winner: "uid-2" }));
    expect(applyGameStatsMock).toHaveBeenCalledTimes(1);
    expect(applyGameStatsMock).toHaveBeenCalledWith({ __db: "skatehubba" }, GAME_ID);
  });
});

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

const applyGameStatsMock = vi.fn<(...args: unknown[]) => Promise<string>>();
const initializeAppMock = vi.fn();
const getFirestoreMock = vi.fn((dbId: string): { __db: string } => ({ __db: dbId }));

vi.mock("firebase-admin/app", () => ({
  initializeApp: () => initializeAppMock(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: (dbId: string) => getFirestoreMock(dbId),
}));

vi.mock("firebase-functions/v2/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase-functions/v2/firestore")>();
  return {
    ...actual,
    onDocumentUpdated: (options: Record<string, unknown>, handler: Handler) => {
      captured.options = options;
      captured.handler = handler;
      return actual.onDocumentUpdated(
        options as Parameters<typeof actual.onDocumentUpdated>[0],
        handler as Parameters<typeof actual.onDocumentUpdated>[1],
      );
    },
  };
});

vi.mock("./applyGameStats.js", () => ({
  applyGameStats: (...args: unknown[]) => applyGameStatsMock(...args),
}));

const GAME_ID = "game-1";
const RUNTIME_SERVICE_ACCOUNT = "sk8hub-d7806@appspot.gserviceaccount.com";

type FunctionsModule = typeof import("./index.js");

let loaded: FunctionsModule | null = null;

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
  loaded = null;
  captured.handler = null;
  captured.options = null;
  applyGameStatsMock.mockReset().mockResolvedValue("applied");
  initializeAppMock.mockReset();
  getFirestoreMock.mockClear();
  // Fresh import wires the trigger, populating `captured`.
  loaded = await import("./index.js");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("v2 runtime identity", () => {
  it("runs every function as the App Engine default service account", () => {
    const names = [
      "onGameCompleted",
      "diceAction",
      "diceSweep",
      "moderateNewClip",
      "moderateClipReport",
      "decideClipModeration",
    ] as const satisfies ReadonlyArray<keyof FunctionsModule>;

    expect(loaded).not.toBeNull();
    const endpoints = Object.fromEntries(
      names.map((name) => [name, loaded?.[name].__endpoint.serviceAccountEmail]),
    );
    expect(endpoints).toEqual({
      onGameCompleted: RUNTIME_SERVICE_ACCOUNT,
      diceAction: RUNTIME_SERVICE_ACCOUNT,
      diceSweep: RUNTIME_SERVICE_ACCOUNT,
      moderateNewClip: RUNTIME_SERVICE_ACCOUNT,
      moderateClipReport: RUNTIME_SERVICE_ACCOUNT,
      decideClipModeration: RUNTIME_SERVICE_ACCOUNT,
    });

    // Per-function options still win over the shared defaults.
    expect(loaded?.onGameCompleted.__endpoint.region).toEqual(["us-central1"]);
    expect(loaded?.onGameCompleted.__endpoint.eventTrigger?.retry).toBe(true);
    expect(loaded?.diceSweep.__endpoint.region).toEqual(["us-central1"]);
    expect(loaded?.diceSweep.__endpoint.scheduleTrigger?.schedule).toBe("every 15 minutes");
    expect(loaded?.moderateNewClip.__endpoint.timeoutSeconds).toBe(300);
    expect(loaded?.moderateNewClip.__endpoint.availableMemoryMb).toBe(512);
    expect(loaded?.moderateClipReport.__endpoint.timeoutSeconds).toBe(60);
    expect(captured.options).not.toHaveProperty("serviceAccount");
  });
});

describe("onGameCompleted trigger", () => {
  it("registers against the named database 'skatehubba' in us-central1", () => {
    expect(captured.options).toMatchObject({
      document: "games/{gameId}",
      database: "skatehubba",
      region: "us-central1",
      retry: true,
    });
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });

  // onDocumentUpdated does not fire on delete — this covers the defensive
  // guard for the rare case where the SDK hands us an event without snapshots.
  it("skips when the event snapshot is unavailable", async () => {
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
    expect(applyGameStatsMock).toHaveBeenCalledWith({ __db: "skatehubba" }, GAME_ID, {
      enabled: false,
      testers: "",
    });
  });

  it("dispatches to applyGameStats on a forfeit with a valid winner", async () => {
    await captured.handler?.(event({ status: "forfeit", winner: "uid-2" }));
    expect(applyGameStatsMock).toHaveBeenCalledTimes(1);
    expect(applyGameStatsMock).toHaveBeenCalledWith({ __db: "skatehubba" }, GAME_ID, {
      enabled: false,
      testers: "",
    });
  });

  it("rethrows a close-out failure so the trigger retry can run again", async () => {
    applyGameStatsMock.mockRejectedValueOnce(new Error("unavailable"));
    await expect(captured.handler?.(event({ status: "complete", winner: "uid-1" }))).rejects.toThrow("unavailable");
  });
});

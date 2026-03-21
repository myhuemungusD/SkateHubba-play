import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Mock firebase-admin ────────────────────────────────── */

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockAdd = vi.fn();
const mockDoc = vi.fn(() => ({
  get: mockGet,
  update: mockUpdate,
}));
const mockCollection = vi.fn(() => ({ add: mockAdd }));
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
  async (callback: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<void>) => {
    return callback({ get: mockTxGet, update: mockTxUpdate });
  },
);
const mockGetFirestore = vi.fn(() => ({
  doc: mockDoc,
  collection: mockCollection,
  runTransaction: mockRunTransaction,
}));

const mockSendEachForMulticast = vi.fn();
const mockGetMessaging = vi.fn(() => ({
  sendEachForMulticast: mockSendEachForMulticast,
}));

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: (...args: unknown[]) => mockGetFirestore(...args),
  FieldValue: {
    arrayRemove: (...tokens: string[]) => ({ _op: "arrayRemove", tokens }),
    serverTimestamp: () => ({ _op: "serverTimestamp" }),
  },
}));

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => mockGetMessaging(),
}));

/* ── Mock firebase-functions ────────────────────────────── */

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
  onDocumentUpdated: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2/pubsub", () => ({
  onMessagePublished: (_opts: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/v2", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/* ── Import handlers (they are the raw handler functions thanks to mocks) ── */

let onNudgeCreated: any;

let onGameCreated: any;

let onGameUpdated: any;

let onBillingAlert: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-import to get fresh handler references
  const mod = await import("../index.js");
  onNudgeCreated = mod.onNudgeCreated;
  onGameCreated = mod.onGameCreated;
  onGameUpdated = mod.onGameUpdated;
  onBillingAlert = mod.onBillingAlert;
});

/* ── Helper to set up FCM token retrieval ─────────────── */

function mockUserTokens(tokens: string[]) {
  mockGet.mockResolvedValueOnce({
    data: () => ({ fcmTokens: tokens }),
  });
}

function mockSendSuccess(successCount: number) {
  mockSendEachForMulticast.mockResolvedValueOnce({
    successCount,
    responses: Array.from({ length: successCount }, () => ({ success: true })),
  });
}

/* ── Tests ──────────────────────────────────────────────── */

describe("onNudgeCreated", () => {
  it("sends a push notification to the recipient", async () => {
    mockUserTokens(["token-abc"]);
    mockSendSuccess(1);
    const mockEventUpdate = vi.fn();

    await onNudgeCreated({
      data: {
        data: () => ({
          recipientUid: "user-2",
          senderUsername: "mike",
          gameId: "game-1",
        }),
        id: "nudge-1",
        ref: { update: mockEventUpdate },
      },
      params: { nudgeId: "nudge-1" },
    });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ["token-abc"],
        notification: expect.objectContaining({
          body: "@mike is waiting for your move",
        }),
      }),
    );
    expect(mockEventUpdate).toHaveBeenCalledWith({ delivered: true });
  });

  it("skips gracefully when event data is missing", async () => {
    await onNudgeCreated({ data: undefined });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});

describe("onGameCreated", () => {
  it("notifies player2 of a new challenge", async () => {
    mockUserTokens(["token-p2"]);
    mockSendSuccess(1);

    await onGameCreated({
      data: {
        data: () => ({
          player2Uid: "user-2",
          player1Username: "alice",
        }),
      },
      params: { gameId: "game-1" },
    });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ["token-p2"],
        notification: expect.objectContaining({
          title: "New Challenge! 🛹",
          body: "@alice challenged you to S.K.A.T.E.",
        }),
        data: { gameId: "game-1", type: "new_challenge" },
      }),
    );
  });

  it("skips when event data is missing", async () => {
    await onGameCreated({ data: undefined });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});

describe("onGameUpdated", () => {
  it("notifies both players and updates stats when a game completes", async () => {
    // Two calls to getFcmTokens (one per player)
    mockUserTokens(["token-p1"]);
    mockSendSuccess(1);
    mockUserTokens(["token-p2"]);
    mockSendSuccess(1);

    // Transaction reads for stats update (one per player)
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ wins: 3, losses: 1, lastStatsGameId: "old-game" }),
    });
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ wins: 0, losses: 2, lastStatsGameId: "old-game" }),
    });

    await onGameUpdated({
      data: {
        before: {
          data: () => ({
            status: "active",
            currentTurn: "user-1",
            phase: "matching",
          }),
        },
        after: {
          data: () => ({
            status: "complete",
            winner: "user-1",
            player1Uid: "user-1",
            player2Uid: "user-2",
            player1Username: "alice",
            player2Username: "bob",
            currentTurn: "user-1",
            phase: "matching",
          }),
        },
      },
      params: { gameId: "game-1" },
    });

    // Push notifications sent for both players
    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);

    // Stats updated via transactions
    expect(mockRunTransaction).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);

    // Winner gets +1 win
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wins: 4, lastStatsGameId: "game-1" }),
    );
    // Loser gets +1 loss
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ losses: 3, lastStatsGameId: "game-1" }),
    );
  });

  it("skips stats update when lastStatsGameId matches (idempotency)", async () => {
    mockUserTokens(["token-p1"]);
    mockSendSuccess(1);
    mockUserTokens(["token-p2"]);
    mockSendSuccess(1);

    // Both users already have stats for this game
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ wins: 4, losses: 1, lastStatsGameId: "game-1" }),
    });
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ wins: 0, losses: 3, lastStatsGameId: "game-1" }),
    });

    await onGameUpdated({
      data: {
        before: {
          data: () => ({
            status: "active",
            currentTurn: "user-1",
            phase: "matching",
          }),
        },
        after: {
          data: () => ({
            status: "complete",
            winner: "user-1",
            player1Uid: "user-1",
            player2Uid: "user-2",
            player1Username: "alice",
            player2Username: "bob",
            currentTurn: "user-1",
            phase: "matching",
          }),
        },
      },
      params: { gameId: "game-1" },
    });

    // Transactions ran but no updates due to idempotency
    expect(mockRunTransaction).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("skips stats for deleted user profiles", async () => {
    mockUserTokens(["token-p1"]);
    mockSendSuccess(1);
    mockUserTokens(["token-p2"]);
    mockSendSuccess(1);

    // Player 1 profile deleted, player 2 exists
    mockTxGet.mockResolvedValueOnce({ exists: false });
    mockTxGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ wins: 0, losses: 0, lastStatsGameId: "old-game" }),
    });

    await onGameUpdated({
      data: {
        before: {
          data: () => ({
            status: "active",
            currentTurn: "user-1",
            phase: "matching",
          }),
        },
        after: {
          data: () => ({
            status: "forfeit",
            winner: "user-2",
            player1Uid: "user-1",
            player2Uid: "user-2",
            player1Username: "alice",
            player2Username: "bob",
            currentTurn: "user-1",
            phase: "matching",
          }),
        },
      },
      params: { gameId: "game-1" },
    });

    // Only one update — the deleted profile is skipped
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wins: 1, lastStatsGameId: "game-1" }),
    );
  });

  it("notifies the next player when the turn changes", async () => {
    mockUserTokens(["token-p2"]);
    mockSendSuccess(1);

    await onGameUpdated({
      data: {
        before: {
          data: () => ({
            status: "active",
            currentTurn: "user-1",
            phase: "setting",
          }),
        },
        after: {
          data: () => ({
            status: "active",
            currentTurn: "user-2",
            phase: "matching",
            currentTrickName: "kickflip",
            player1Uid: "user-1",
            player2Uid: "user-2",
            player1Username: "alice",
            player2Username: "bob",
          }),
        },
      },
      params: { gameId: "game-1" },
    });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ["token-p2"],
        notification: expect.objectContaining({
          title: "Your Turn! 🎯",
          body: "Match @alice's kickflip",
        }),
      }),
    );
  });

  it("sends setting notification for setting phase", async () => {
    mockUserTokens(["token-p1"]);
    mockSendSuccess(1);

    await onGameUpdated({
      data: {
        before: {
          data: () => ({
            status: "active",
            currentTurn: "user-2",
            phase: "matching",
          }),
        },
        after: {
          data: () => ({
            status: "active",
            currentTurn: "user-1",
            phase: "setting",
            player1Uid: "user-1",
            player2Uid: "user-2",
            player1Username: "alice",
            player2Username: "bob",
          }),
        },
      },
      params: { gameId: "game-1" },
    });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          title: "Your Turn to Set! 🛹",
        }),
      }),
    );
  });

  it("skips when data is missing", async () => {
    await onGameUpdated({ data: undefined });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});

describe("onBillingAlert", () => {
  it("logs and persists the billing alert to Firestore", async () => {
    mockAdd.mockResolvedValueOnce({});

    const alertData = {
      budgetDisplayName: "SkateHubba",
      costAmount: 25.5,
      budgetAmount: 50,
      currencyCode: "USD",
      alertThresholdExceeded: 0.5,
      costIntervalStart: "2026-03-01",
    };

    await onBillingAlert({
      data: {
        message: {
          json: alertData,
        },
      },
    });

    expect(mockCollection).toHaveBeenCalledWith("billingAlerts");
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetDisplayName: "SkateHubba",
        costAmount: 25.5,
        thresholdPercent: "50%",
      }),
    );
  });

  it("handles string JSON payload", async () => {
    mockAdd.mockResolvedValueOnce({});

    const alertData = {
      budgetDisplayName: "Test",
      costAmount: 10,
      budgetAmount: 100,
      currencyCode: "USD",
      costIntervalStart: "2026-03-01",
    };

    await onBillingAlert({
      data: {
        message: {
          json: JSON.stringify(alertData),
        },
      },
    });

    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetDisplayName: "Test",
        thresholdPercent: "unknown",
      }),
    );
  });
});

describe("sendPush (via onNudgeCreated)", () => {
  it("cleans up invalid tokens", async () => {
    mockGet.mockResolvedValueOnce({
      data: () => ({ fcmTokens: ["valid", "invalid-1", "invalid-2"] }),
    });
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 1,
      responses: [
        { success: true },
        { error: { code: "messaging/invalid-registration-token" } },
        { error: { code: "messaging/registration-token-not-registered" } },
      ],
    });

    await onNudgeCreated({
      data: {
        data: () => ({
          recipientUid: "user-2",
          senderUsername: "mike",
          gameId: "game-1",
        }),
        id: "nudge-1",
        ref: { update: vi.fn() },
      },
      params: { nudgeId: "nudge-1" },
    });

    // Should update user doc to remove invalid tokens
    expect(mockDoc).toHaveBeenCalledWith("users/user-2");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        fcmTokens: expect.objectContaining({ _op: "arrayRemove", tokens: ["invalid-1", "invalid-2"] }),
      }),
    );
  });

  it("skips push when no tokens available", async () => {
    mockGet.mockResolvedValueOnce({
      data: () => ({ fcmTokens: [] }),
    });

    await onNudgeCreated({
      data: {
        data: () => ({
          recipientUid: "user-2",
          senderUsername: "mike",
          gameId: "game-1",
        }),
        id: "nudge-1",
        ref: { update: vi.fn() },
      },
      params: { nudgeId: "nudge-1" },
    });

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});

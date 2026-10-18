import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({ Timestamp: { fromMillis: (ms: number) => ({ ms }) } }));
vi.mock("firebase-functions/v2/https", () => ({
  HttpsError: class extends Error {
    constructor(
      public code: string,
      msg: string,
    ) {
      super(msg);
    }
  },
}));
import { computeAnalytics, handleAnalyticsCall } from "./analytics.js";

const NOW = 100 * 86_400_000;
const at = (ms: number) => ({ toMillis: () => ms });
function fakeDb() {
  const counts: Record<string, number> = { users: 4, games: 9, clips: 6 };
  const gameDocs = [
    { player1Uid: "a", player2Uid: "b", status: "complete", updatedAt: at(NOW - 1000) },
    { player1Uid: "c", player2Uid: "", status: "active", updatedAt: at(NOW - 3 * 86_400_000) },
    { player1Uid: "a", player2Uid: "d", status: "forfeit", updatedAt: {} },
  ];
  const q = (col: string, wheres: unknown[][] = []): unknown => ({
    where: (...w: unknown[]) => q(col, [...wheres, w]),
    limit: () => q(col, wheres),
    count: () => ({ get: async () => ({ data: () => ({ count: counts[col] }) }) }),
    get: async () => ({
      docs:
        col === "games"
          ? gameDocs.map((data) => ({ id: "g", data: () => data }))
          : [{ id: "c" }, { id: "z" }].map((d) => ({ ...d, data: () => ({}) })),
    }),
  });
  return { collection: (c: string) => q(c) } as never;
}

describe("computeAnalytics", () => {
  it("counts and derives players, finishes and retention", async () => {
    expect(await computeAnalytics(fakeDb(), NOW)).toEqual({
      dailyPlayers: 2,
      weeklyPlayers: 4,
      newPlayers7d: 4,
      gamesStarted7d: 9,
      gamesFinished7d: 2,
      clipsPosted7d: 6,
      retention: { cohort: 2, returned: 1 },
      generatedAtMs: NOW,
    });
  });
});

describe("handleAnalyticsCall", () => {
  it("needs a signed-in admin claim", async () => {
    await expect(handleAnalyticsCall({ auth: undefined }, fakeDb(), NOW)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      handleAnalyticsCall({ auth: { uid: "p", token: { isVerifiedPro: true } } } as never, fakeDb(), NOW),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      handleAnalyticsCall({ auth: { uid: "x", token: { admin: true } } } as never, fakeDb(), NOW),
    ).resolves.toMatchObject({ dailyPlayers: 2 });
  });
});

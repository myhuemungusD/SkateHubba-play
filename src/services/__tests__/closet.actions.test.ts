import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "../analytics";
import { logger } from "../logger";

type AnyMock = (...args: unknown[]) => unknown;

const call = vi.hoisted(() => vi.fn());
const mockGetDoc = vi.fn<AnyMock>();
const mockGetDocs = vi.fn<AnyMock>();

vi.mock("../../firebase");
vi.mock("../closet.callable", () => ({ callCloset: (...a: unknown[]) => call(...a) }));
vi.mock("../analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../utils/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));
vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => args.slice(1).join("/"),
  doc: (...args: unknown[]) => args.slice(1).join("/"),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (...args: unknown[]) => args,
}));

import { claimDrop, enterDraw, fetchActiveDrops, fetchDrawEntry, fetchDrop, fetchDropClaim } from "../closet.drops";
import { buyShopItem, equipItem } from "../closet.shop";
import { confirmTrade, fetchTrade, fetchUserTrades, proposeTrade, respondTrade } from "../closet.trading";

const ts = (iso: string) => ({ toDate: () => new Date(iso) });
const snap = (id: string, data: Record<string, unknown> | undefined) => ({ id, data: () => data });
const HOUR = 3_600_000;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("closet drops reads", () => {
  it("parses a live limited drop", async () => {
    mockGetDoc.mockResolvedValueOnce(
      snap("d1", {
        itemDefId: "mike_white_teeth_fire",
        startsAt: { toDate: () => new Date(Date.now() - HOUR) },
        endsAt: { toDate: () => new Date(Date.now() + HOUR) },
        stock: 10,
        claimed: 4,
        requiresGames: 3,
        requiresAccountDays: 7,
      }),
    );
    const drop = await fetchDrop("d1");
    expect(drop).toMatchObject({
      id: "d1",
      itemDefId: "mike_white_teeth_fire",
      stock: 10,
      claimed: 4,
      requiresGames: 3,
      requiresAccountDays: 7,
      isLive: true,
      isSoldOut: false,
      isDraw: false,
      drawEntryWindowEndsAt: null,
    });
  });

  it("defaults missing numbers, flags draws, and treats zero stock as sold out", async () => {
    mockGetDoc.mockResolvedValueOnce(
      snap("d2", {
        startsAt: ts("2020-01-01T00:00:00Z"),
        endsAt: ts("2020-01-02T00:00:00Z"),
        drawEntryWindowEndsAt: ts("2020-01-01T12:00:00Z"),
      }),
    );
    const drop = await fetchDrop("d2");
    expect(drop).toMatchObject({ itemDefId: "", stock: 0, claimed: 0, isLive: false, isSoldOut: true, isDraw: true });
  });

  it("returns null for a missing doc, bad dates, or a read error", async () => {
    mockGetDoc.mockResolvedValueOnce(snap("x", undefined));
    expect(await fetchDrop("x")).toBeNull();
    mockGetDoc.mockResolvedValueOnce(snap("x", { startsAt: ts("2020-01-01T00:00:00Z") }));
    expect(await fetchDrop("x")).toBeNull();
    mockGetDoc.mockRejectedValueOnce(new Error("denied"));
    expect(await fetchDrop("x")).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith("fetch_drop_failed", expect.anything());
  });

  it("lists active drops, skipping malformed ones, and fails soft", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        snap("ok", { startsAt: ts("2020-01-01T00:00:00Z"), endsAt: ts("2099-01-01T00:00:00Z"), stock: 1 }),
        snap("bad", {}),
      ],
    });
    const drops = await fetchActiveDrops();
    expect(drops.map((d) => d.id)).toEqual(["ok"]);
    mockGetDocs.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchActiveDrops()).toEqual([]);
  });

  it("reads the viewer's claim with defaults", async () => {
    mockGetDoc.mockResolvedValueOnce(snap("me", { claimedAt: ts("2026-10-17T00:00:00Z"), serial: 7, copyId: "c7" }));
    expect(await fetchDropClaim("d1", "me")).toEqual({
      claimedAt: new Date("2026-10-17T00:00:00Z"),
      serial: 7,
      copyId: "c7",
    });
    mockGetDoc.mockResolvedValueOnce(snap("me", {}));
    expect(await fetchDropClaim("d1", "me")).toMatchObject({ serial: 0, copyId: "" });
    mockGetDoc.mockResolvedValueOnce(snap("me", undefined));
    expect(await fetchDropClaim("d1", "me")).toBeNull();
    mockGetDoc.mockRejectedValueOnce(new Error("denied"));
    expect(await fetchDropClaim("d1", "me")).toBeNull();
  });

  it("reads the viewer's draw entry with defaults", async () => {
    mockGetDoc.mockResolvedValueOnce(snap("me", { enteredAt: ts("2026-10-17T00:00:00Z"), eligible: true }));
    expect(await fetchDrawEntry("d1", "me")).toEqual({ enteredAt: new Date("2026-10-17T00:00:00Z"), eligible: true });
    mockGetDoc.mockResolvedValueOnce(snap("me", {}));
    expect(await fetchDrawEntry("d1", "me")).toMatchObject({ eligible: false });
    mockGetDoc.mockResolvedValueOnce(snap("me", undefined));
    expect(await fetchDrawEntry("d1", "me")).toBeNull();
    mockGetDoc.mockRejectedValueOnce(new Error("denied"));
    expect(await fetchDrawEntry("d1", "me")).toBeNull();
  });
});

describe("closet callables", () => {
  it.each([
    ["claimDrop", () => claimDrop("d1"), { dropId: "d1" }, "closet_drop_claimed", { copyId: "c1", serial: 1 }],
    ["enterDraw", () => enterDraw("d1"), { dropId: "d1" }, "closet_draw_entered", undefined],
    ["buyShopItem", () => buyShopItem("deck"), { itemDefId: "deck" }, "closet_shop_purchase", { copyId: "c2" }],
    ["equipItem", () => equipItem("c2", true), { copyId: "c2", equip: true }, "closet_item_equipped", undefined],
    ["confirmTrade", () => confirmTrade("t1"), { tradeId: "t1" }, "closet_trade_confirmed", undefined],
    [
      "respondTrade",
      () => respondTrade({ tradeId: "t1", response: "accept" }),
      { tradeId: "t1", response: "accept" },
      "closet_trade_responded",
      undefined,
    ],
    [
      "proposeTrade",
      () => proposeTrade({ recipientUid: "bob", proposerCopyIds: ["c1"], recipientCopyIds: ["c2"], note: "fair?" }),
      { toUid: "bob", give: ["c1"], get: ["c2"], note: "fair?" },
      "closet_trade_proposed",
      { tradeId: "t9" },
    ],
    [
      "respondTrade",
      () =>
        proposeTrade({
          recipientUid: "bob",
          proposerCopyIds: ["c1"],
          recipientCopyIds: ["c2"],
          counterToTradeId: "t1",
        }),
      { toUid: "bob", give: ["c1"], get: ["c2"], tradeId: "t1", response: "counter" },
      "closet_trade_proposed",
      { tradeId: "t10" },
    ],
  ] as const)("%s calls the server and tracks it", async (name, run, payload, event, result) => {
    call.mockResolvedValueOnce(result);
    await expect(run()).resolves.toEqual(result);
    expect(call).toHaveBeenCalledWith(name, payload);
    expect(trackEvent).toHaveBeenCalledWith(event, expect.anything());
  });

  it.each([
    ["claim_drop_failed", () => claimDrop("d1")],
    ["enter_draw_failed", () => enterDraw("d1")],
    ["buy_shop_item_failed", () => buyShopItem("deck")],
    ["equip_item_failed", () => equipItem("c2", false)],
    ["confirm_trade_failed", () => confirmTrade("t1")],
    ["respond_trade_failed", () => respondTrade({ tradeId: "t1", response: "decline" })],
    ["propose_trade_failed", () => proposeTrade({ recipientUid: "bob", proposerCopyIds: [], recipientCopyIds: [] })],
  ] as const)("logs %s and rethrows", async (event, run) => {
    call.mockRejectedValueOnce(new Error("nope"));
    await expect(run()).rejects.toThrow("nope");
    expect(logger.warn).toHaveBeenCalledWith(event, expect.anything());
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe("closet trades reads (the schema the callables write)", () => {
  const tradeData = (createdAt: string, extra: Record<string, unknown> = {}) => ({
    fromUid: "me",
    toUid: "bob",
    parties: ["me", "bob"],
    give: [{ copyId: "c1", itemDefId: "teeth", name: "Teeth", rarity: "limited", serial: 3 }],
    get: [{ copyId: "c2", itemDefId: "deck", name: "Deck", rarity: "common", serial: null }],
    status: "pending",
    confirmedBy: [],
    note: "fair?",
    createdAt: ts(createdAt),
    updatedAt: ts(createdAt),
    ...extra,
  });

  it("maps fromUid/toUid, give/get and the hold date", async () => {
    mockGetDoc.mockResolvedValueOnce(
      snap(
        "t1",
        tradeData("2026-10-17T00:00:00Z", {
          status: "held",
          confirmedBy: ["me", "bob", 7],
          releaseAt: ts("2026-10-24T00:00:00Z"),
          updatedAt: ts("2026-10-18T00:00:00Z"),
        }),
      ),
    );
    expect(await fetchTrade("t1")).toEqual({
      id: "t1",
      proposerUid: "me",
      recipientUid: "bob",
      proposerItems: [{ copyId: "c1", name: "Teeth", rarity: "limited", imageUrl: null }],
      recipientItems: [{ copyId: "c2", name: "Deck", rarity: "common", imageUrl: null }],
      status: "held",
      confirmedBy: ["me", "bob"],
      note: "fair?",
      proposedAt: new Date("2026-10-17T00:00:00Z"),
      respondedAt: new Date("2026-10-18T00:00:00Z"),
      completedAt: null,
      holdUntil: new Date("2026-10-24T00:00:00Z"),
    });
  });

  it.each([
    ["pending", "proposed"],
    ["accepted", "accepted"],
    ["held", "held"],
    ["completed", "complete"],
    ["declined", "declined"],
    ["cancelled", "canceled"],
    ["countered", "canceled"],
    ["expired", "canceled"],
    ["failed", "canceled"],
    ["reversed", "canceled"],
  ])("server status %s shows as %s", async (server, shown) => {
    mockGetDoc.mockResolvedValueOnce(snap("t", tradeData("2026-10-17T00:00:00Z", { status: server })));
    expect((await fetchTrade("t"))?.status).toBe(shown);
  });

  it("defaults odd fields", async () => {
    mockGetDoc.mockResolvedValueOnce(snap("t2", { createdAt: ts("2026-10-17T00:00:00Z"), give: [null, "x"] }));
    expect(await fetchTrade("t2")).toEqual({
      id: "t2",
      proposerUid: "",
      recipientUid: "",
      proposerItems: [],
      recipientItems: [],
      status: "proposed",
      confirmedBy: [],
      note: null,
      proposedAt: new Date("2026-10-17T00:00:00Z"),
      respondedAt: null,
      completedAt: null,
      holdUntil: null,
    });
  });

  it("returns null for missing, undated or unreadable trades", async () => {
    mockGetDoc.mockResolvedValueOnce(snap("t", undefined));
    expect(await fetchTrade("t")).toBeNull();
    // The old field names are not a trade: no createdAt.
    mockGetDoc.mockResolvedValueOnce(snap("t", { proposerUid: "me", proposedAt: ts("2026-10-17T00:00:00Z") }));
    expect(await fetchTrade("t")).toBeNull();
    mockGetDoc.mockRejectedValueOnce(new Error("denied"));
    expect(await fetchTrade("t")).toBeNull();
  });

  it("queries each side by its own party field, merged newest first", async () => {
    mockGetDocs
      .mockResolvedValueOnce({ docs: [snap("old", tradeData("2026-10-01T00:00:00Z")), snap("junk", {})] })
      .mockResolvedValueOnce({
        docs: [snap("new", tradeData("2026-10-10T00:00:00Z", { fromUid: "bob", toUid: "me" }))],
      });
    expect((await fetchUserTrades("me")).map((t) => t.id)).toEqual(["new", "old"]);
    const queries = mockGetDocs.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(queries[0]).toContain('["fromUid","==","me"]');
    expect(queries[1]).toContain('["toUid","==","me"]');
    expect(queries.join()).not.toMatch(/proposerUid|recipientUid/);
    expect(queries.join()).toContain('["createdAt","desc"]');
  });

  it("filters by the shown status after mapping, and fails soft", async () => {
    mockGetDocs
      .mockResolvedValueOnce({ docs: [snap("a", tradeData("2026-10-01T00:00:00Z", { status: "held" }))] })
      .mockResolvedValueOnce({ docs: [snap("b", tradeData("2026-10-02T00:00:00Z"))] });
    expect((await fetchUserTrades("me", "held")).map((t) => t.id)).toEqual(["a"]);
    mockGetDocs.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchUserTrades("me")).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("fetch_user_trades_failed", expect.anything());
  });
});

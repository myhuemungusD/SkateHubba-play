import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogItem } from "../../services/closet.catalog";
import type { Drop } from "../../services/closet.drops";
import type { Trade } from "../../services/closet.trading";

const auth = vi.hoisted(() => ({ user: { uid: "me-123456789" } as { uid: string } | null }));
const flags = vi.hoisted(() => ({ drops: true, trading: true }));
const svc = vi.hoisted(() => ({
  fetchShopItems: vi.fn(),
  fetchWalletBalance: vi.fn(),
  buyShopItem: vi.fn(),
  fetchActiveDrops: vi.fn(),
  fetchDropClaim: vi.fn(),
  fetchDrawEntry: vi.fn(),
  claimDrop: vi.fn(),
  enterDraw: vi.fn(),
  fetchCatalogItem: vi.fn(),
  fetchUserTrades: vi.fn(),
  proposeTrade: vi.fn(),
  respondTrade: vi.fn(),
  confirmTrade: vi.fn(),
  fetchLockerItems: vi.fn(),
}));

vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("../../lib/featureFlags", () => ({
  isClosetDropsEnabled: () => flags.drops,
  isClosetTradingEnabled: () => flags.trading,
}));
vi.mock("../../services/closet", () => svc);
vi.mock("../../services/closet.drops", () => svc);
vi.mock("../../services/closet.catalog", () => svc);
vi.mock("../../services/closet.trading", () => svc);
vi.mock("../../services/locker", () => svc);
vi.mock("../../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../services/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { ClosetShopScreen } from "../ClosetShopScreen";
import { DropDayScreen } from "../DropDayScreen";
import { TradingScreen } from "../TradingScreen";

function catalogItem(over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "deck_1",
    name: "Shop Deck",
    type: "deck",
    slot: "deck",
    rarity: "common",
    artUrl: "/deck.png",
    layerUrls: { front: "", back: null },
    model3dUrl: null,
    edition: { kind: "open", supply: null, minted: 0, soldOut: false },
    source: "shop",
    priceBucks: 100,
    dropId: null,
    licensed: { brand: "Hubba", licenseRef: null },
    releasedAt: null,
    retiredAt: null,
    ...over,
  };
}

function drop(over: Partial<Drop> = {}): Drop {
  return {
    id: "d1",
    itemDefId: "mike_white_teeth_fire",
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 86_400_000),
    drawEntryWindowEndsAt: null,
    stock: 10,
    claimed: 2,
    requiresGames: 0,
    requiresAccountDays: 0,
    isLive: true,
    isSoldOut: false,
    isDraw: false,
    ...over,
  };
}

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    proposerUid: "bob-abcdefghij",
    recipientUid: "me-123456789",
    proposerItems: [{ copyId: "c1", name: "Teeth — Fire Red", rarity: "limited", imageUrl: null }],
    recipientItems: [{ copyId: "c2", name: "Shop Deck", rarity: "common", imageUrl: null }],
    status: "proposed",
    confirmedBy: [],
    note: "swap?",
    proposedAt: new Date("2026-10-17T00:00:00Z"),
    respondedAt: null,
    completedAt: null,
    holdUntil: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { uid: "me-123456789" };
  flags.drops = true;
  flags.trading = true;
  svc.fetchWalletBalance.mockResolvedValue({ balance: 150, earnedBal: 150, boughtBal: 0 });
  svc.fetchShopItems.mockResolvedValue([]);
  svc.fetchActiveDrops.mockResolvedValue([]);
  svc.fetchDropClaim.mockResolvedValue(null);
  svc.fetchDrawEntry.mockResolvedValue(null);
  svc.fetchCatalogItem.mockResolvedValue(null);
  svc.fetchUserTrades.mockResolvedValue([]);
  svc.fetchLockerItems.mockResolvedValue([]);
});

describe("ClosetShopScreen", () => {
  it("shows the empty shop with the wallet", async () => {
    render(<ClosetShopScreen />);
    expect(await screen.findByText(/no items available/i)).toBeInTheDocument();
    expect(screen.getByTestId("wallet-balance")).toHaveTextContent("150");
  });

  it("buys an affordable item and refreshes the wallet", async () => {
    svc.fetchShopItems.mockResolvedValueOnce([
      catalogItem(),
      catalogItem({
        id: "grail",
        name: "Pricey",
        priceBucks: 999,
        rarity: "grail",
        artUrl: "",
        licensed: { brand: null, licenseRef: null },
      }),
    ]);
    svc.buyShopItem.mockResolvedValueOnce({ copyId: "c1" });
    render(<ClosetShopScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Buy" }));
    await waitFor(() => expect(svc.buyShopItem).toHaveBeenCalledWith("deck_1"));
    expect(svc.fetchWalletBalance).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /not enough bucks/i })).toBeDisabled();
  });

  it("shows friendly errors for owned items and other failures", async () => {
    svc.fetchShopItems.mockResolvedValue([catalogItem()]);
    svc.buyShopItem.mockRejectedValueOnce({ code: "already_owned" }).mockRejectedValueOnce(new Error("boom"));
    render(<ClosetShopScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Buy" }));
    expect(await screen.findByText("You already own this item")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buy" }));
    await waitFor(() => expect(screen.queryByText("You already own this item")).not.toBeInTheDocument());
  });

  it("credits Mike White on his items", async () => {
    svc.fetchShopItems.mockResolvedValueOnce([catalogItem({ id: "mike_white_teeth_fire", name: "Teeth" })]);
    render(<ClosetShopScreen />);
    expect(await screen.findByText("Designed by Mike White")).toBeInTheDocument();
  });

  it("surfaces a load failure", async () => {
    svc.fetchShopItems.mockRejectedValueOnce(new Error("offline"));
    render(<ClosetShopScreen />);
    expect(await screen.findByText(/no items available/i)).toBeInTheDocument();
    expect(document.querySelector(".text-red-400")).toBeInTheDocument();
  });
});

describe("DropDayScreen", () => {
  it("stays dark while the drops flag is off", () => {
    flags.drops = false;
    render(<DropDayScreen />);
    expect(screen.getByText(/drop day is in testing/i)).toBeInTheDocument();
    expect(svc.fetchActiveDrops).not.toHaveBeenCalled();
  });

  it("shows the empty state", async () => {
    render(<DropDayScreen />);
    expect(await screen.findByText(/no active drops/i)).toBeInTheDocument();
  });

  it("claims a live limited drop and reloads", async () => {
    svc.fetchActiveDrops.mockResolvedValue([drop()]);
    svc.fetchCatalogItem.mockResolvedValue(catalogItem({ name: "Teeth" }));
    svc.claimDrop.mockResolvedValueOnce({ copyId: "c1", serial: 3 });
    render(<DropDayScreen />);
    expect(await screen.findByText("8 / 10")).toBeInTheDocument();
    svc.fetchDropClaim.mockResolvedValue({ claimedAt: new Date(), serial: 3, copyId: "c1" });
    fireEvent.click(screen.getByRole("button", { name: /claim now/i }));
    expect(await screen.findByText(/claimed — serial #3/i)).toBeInTheDocument();
  });

  it("enters a draw, then shows the entry", async () => {
    svc.fetchActiveDrops.mockResolvedValue([drop({ isDraw: true })]);
    svc.enterDraw.mockResolvedValueOnce(undefined);
    render(<DropDayScreen />);
    expect(await screen.findByText("Mystery Item")).toBeInTheDocument();
    svc.fetchDrawEntry.mockResolvedValue({ enteredAt: new Date(), eligible: true });
    fireEvent.click(screen.getByRole("button", { name: /enter draw/i }));
    expect(await screen.findByText(/entered — draw closes/i)).toBeInTheDocument();
  });

  it("shows sold out and upcoming drops with a countdown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    svc.fetchActiveDrops.mockResolvedValue([
      drop({ id: "gone", isSoldOut: true, claimed: 10 }),
      drop({ id: "soon", isLive: false, startsAt: new Date(Date.now() + 90_061_000), stock: 0 }),
    ]);
    render(<DropDayScreen />);
    expect(await screen.findByText(/never return/i)).toBeInTheDocument();
    expect(screen.getByText("DAYS")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();
  });

  it("shows the error screen when a claim or entry fails", async () => {
    svc.fetchActiveDrops.mockResolvedValue([drop(), drop({ id: "d2", isDraw: true })]);
    svc.claimDrop.mockRejectedValueOnce(new Error("sold out"));
    render(<DropDayScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /claim now/i }));
    expect(await screen.findByText(/failed to load drops/i)).toBeInTheDocument();
  });

  it("shows the error screen when entering a draw fails, and on load failure", async () => {
    svc.fetchActiveDrops.mockResolvedValueOnce([drop({ isDraw: true })]);
    svc.enterDraw.mockRejectedValueOnce(new Error("closed"));
    const first = render(<DropDayScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /enter draw/i }));
    expect(await screen.findByText(/failed to load drops/i)).toBeInTheDocument();
    first.unmount();

    svc.fetchActiveDrops.mockRejectedValueOnce(new Error("offline"));
    render(<DropDayScreen />);
    expect(await screen.findByText(/failed to load drops/i)).toBeInTheDocument();
  });
});

describe("TradingScreen", () => {
  it("stays dark while the trading flag is off or signed out", () => {
    flags.trading = false;
    const { rerender } = render(<TradingScreen />);
    expect(screen.getByText(/trading is in testing/i)).toBeInTheDocument();
    flags.trading = true;
    auth.user = null;
    rerender(<TradingScreen />);
    expect(screen.getByText(/trading is in testing/i)).toBeInTheDocument();
  });

  it("accepts an incoming offer and refetches", async () => {
    svc.fetchUserTrades.mockResolvedValue([trade()]);
    svc.respondTrade.mockResolvedValue(undefined);
    render(<TradingScreen />);
    expect(await screen.findByText("swap?")).toBeInTheDocument();
    expect(screen.getByText("They Give")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ACCEPT" }));
    await waitFor(() => expect(svc.respondTrade).toHaveBeenCalledWith({ tradeId: "t1", response: "accept" }));
    await waitFor(() => expect(svc.fetchUserTrades).toHaveBeenCalledTimes(2));
  });

  it("declines, and survives failed responses", async () => {
    svc.fetchUserTrades.mockResolvedValue([trade()]);
    svc.respondTrade
      .mockRejectedValueOnce(new Error("x"))
      .mockRejectedValueOnce(new Error("y"))
      .mockResolvedValueOnce(undefined);
    render(<TradingScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "ACCEPT" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "DECLINE" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "DECLINE" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "DECLINE" }));
    await waitFor(() => expect(svc.respondTrade).toHaveBeenLastCalledWith({ tradeId: "t1", response: "decline" }));
  });

  it("shows a hold's swap date, and confirms an accepted trade once", async () => {
    svc.fetchUserTrades.mockResolvedValue([
      trade({
        id: "mine",
        proposerUid: "me-123456789",
        recipientUid: "bob-abcdefghij",
        status: "accepted",
        note: null,
      }),
      trade({ id: "held", status: "held", holdUntil: new Date(Date.now() + 1e9) }),
      trade({ id: "done-by-me", status: "accepted", confirmedBy: ["me-123456789"], note: null }),
    ]);
    svc.confirmTrade.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(undefined);
    render(<TradingScreen />);
    expect(await screen.findByText(/trade hold/i)).toBeInTheDocument();
    expect(screen.getByText(/items swap on/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting for the other skater/i)).toBeInTheDocument();
    expect(screen.getByText("You Give")).toBeInTheDocument();
    // Only the trade I haven't confirmed offers the button; a held trade has none.
    expect(screen.getAllByRole("button", { name: /confirm trade/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /confirm trade/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /confirm trade/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /confirm trade/i }));
    await waitFor(() => expect(svc.confirmTrade).toHaveBeenCalledTimes(2));
    expect(svc.confirmTrade).toHaveBeenCalledWith("mine");
  });

  it("filters by status", async () => {
    render(<TradingScreen />);
    expect(await screen.findByText(/no trades yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "HELD" }));
    await waitFor(() => expect(svc.fetchUserTrades).toHaveBeenLastCalledWith("me-123456789", "held"));
    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    await waitFor(() => expect(svc.fetchUserTrades).toHaveBeenLastCalledWith("me-123456789", undefined));
  });

  it("shows the error screen on load failure", async () => {
    svc.fetchUserTrades.mockRejectedValueOnce(new Error("offline"));
    render(<TradingScreen />);
    expect(await screen.findByText(/failed to load trades/i)).toBeInTheDocument();
  });

  it("walks through proposing a trade", async () => {
    const lockerItem = (id: string, name: string, over: Record<string, unknown> = {}) => ({
      id,
      type: "deck",
      brand: "",
      name,
      imageUrl: null,
      rarity: "common",
      acquiredAt: null,
      provenanceReason: null,
      equipped: false,
      itemDefId: null,
      ...over,
    });
    svc.fetchLockerItems.mockResolvedValue([
      lockerItem("c1", "Teeth", { type: "shoes", imageUrl: "/t.webp", rarity: "limited" }),
      lockerItem("c2", "Deck"),
    ]);
    const bobsLocker = (n: number) => Array.from({ length: n }, (_, i) => lockerItem(`b${i}`, `Bob ${i}`));
    svc.proposeTrade.mockRejectedValueOnce(new Error("rate")).mockResolvedValueOnce({ tradeId: "t2" });
    render(<TradingScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "NEW TRADE" }));
    fireEvent.click(await screen.findByRole("button", { name: /teeth/i }));
    fireEvent.click(screen.getByRole("button", { name: /deck/i }));
    fireEvent.click(screen.getByRole("button", { name: /deck/i }));
    fireEvent.click(screen.getByRole("button", { name: /next \(1 items\)/i }));
    fireEvent.click(screen.getByRole("button", { name: "BACK" }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // An empty closet on the other side: nothing to ask for, so no offer.
    svc.fetchLockerItems.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByPlaceholderText(/enter user id/i), { target: { value: " bob " } });
    fireEvent.click(screen.getByRole("button", { name: "NEXT" }));
    expect(await screen.findByText(/nothing to trade yet/i)).toBeInTheDocument();
    expect(svc.fetchLockerItems).toHaveBeenLastCalledWith("bob");
    expect(screen.getByRole("button", { name: /send offer/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "BACK" }));

    // Pick from their closet; a fifth pick is ignored (4 per side).
    svc.fetchLockerItems.mockResolvedValueOnce(bobsLocker(5));
    fireEvent.click(screen.getByRole("button", { name: "NEXT" }));
    for (const i of [0, 1, 2, 3, 4])
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(`Bob ${i}$`) }));
    fireEvent.click(screen.getByRole("button", { name: /Bob 3$/ }));
    fireEvent.click(screen.getByRole("button", { name: /send offer/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /send offer/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /send offer/i }));
    await waitFor(() => expect(screen.queryByText(/from their closet/i)).not.toBeInTheDocument());
    expect(svc.proposeTrade).toHaveBeenLastCalledWith({
      recipientUid: "bob",
      proposerCopyIds: ["c1"],
      recipientCopyIds: ["b0", "b1", "b2"],
    });
  });

  it("closes the new-trade modal", async () => {
    render(<TradingScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "NEW TRADE" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/select items you want/i)).not.toBeInTheDocument();
  });
});

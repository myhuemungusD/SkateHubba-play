import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockAwardAchievement = vi.fn();
const mockRevokeAchievement = vi.fn();
const mockAwardLockerItem = vi.fn();
const mockRemoveLockerItem = vi.fn();
const mockGetUidByUsername = vi.fn();
const mockGetUserProfile = vi.fn();
const mockFetchAchievements = vi.fn();
const mockFetchLockerItems = vi.fn();

vi.mock("../../../../services/admin", () => ({
  awardAchievement: (...args: unknown[]) => mockAwardAchievement(...args),
  revokeAchievement: (...args: unknown[]) => mockRevokeAchievement(...args),
  awardLockerItem: (...args: unknown[]) => mockAwardLockerItem(...args),
  removeLockerItem: (...args: unknown[]) => mockRemoveLockerItem(...args),
}));

vi.mock("../../../../services/users", () => ({
  getUidByUsername: (...args: unknown[]) => mockGetUidByUsername(...args),
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
}));

vi.mock("../../../../services/achievements", () => ({
  fetchAchievements: (...args: unknown[]) => mockFetchAchievements(...args),
}));

vi.mock("../../../../services/locker", () => ({
  fetchLockerItems: (...args: unknown[]) => mockFetchLockerItems(...args),
}));

vi.mock("../../../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { AwardsPanel } from "../AwardsPanel";
import { renderWithToasts } from "./adminPanels.test-helpers";

/** Render, look a player up, and wait for both grant surfaces to settle. */
async function renderWithTarget(user: ReturnType<typeof userEvent.setup>) {
  renderWithToasts(<AwardsPanel />);
  await user.type(screen.getByLabelText("PLAYER USERNAME"), "nyjah");
  await user.click(screen.getByRole("button", { name: "Look up player" }));
  await screen.findByTestId("badge-row-century");
  await waitFor(() => expect(screen.queryByText("Loading locker...")).not.toBeInTheDocument());
}

const lockerItem = {
  id: "item1",
  type: "deck",
  brand: "Hubba",
  name: "Ledge Killer",
  imageUrl: null,
  rarity: "rare",
  acquiredAt: null,
  provenanceReason: "Won the 2026 invitational",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUidByUsername.mockResolvedValue("u1");
  mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "nyjah", stance: "regular", createdAt: null });
  mockFetchAchievements.mockResolvedValue([]);
  mockFetchLockerItems.mockResolvedValue([]);
  mockAwardAchievement.mockResolvedValue(undefined);
  mockRevokeAchievement.mockResolvedValue(undefined);
  mockAwardLockerItem.mockResolvedValue("item9");
  mockRemoveLockerItem.mockResolvedValue(undefined);
});

describe("AwardsPanel — badges", () => {
  it("lists the launch badge set for the looked-up player", async () => {
    const user = userEvent.setup();
    await renderWithTarget(user);

    for (const id of ["century", "club150", "og", "streak10", "pioneer"]) {
      expect(screen.getByTestId(`badge-row-${id}`)).toBeInTheDocument();
    }
    expect(mockFetchAchievements).toHaveBeenCalledWith("u1");
  });

  it("blocks awarding until a reason is supplied", async () => {
    const user = userEvent.setup();
    await renderWithTarget(user);

    expect(screen.getByRole("button", { name: "Award Century to nyjah" })).toBeDisabled();

    await user.type(screen.getByLabelText("REASON"), "100 games in");

    expect(screen.getByRole("button", { name: "Award Century to nyjah" })).toBeEnabled();
  });

  it("awards a badge with its reason, toasts, and refetches", async () => {
    const user = userEvent.setup();
    await renderWithTarget(user);
    await user.type(screen.getByLabelText("REASON"), "  100 games in  ");
    mockFetchAchievements.mockResolvedValue([{ id: "century", earnedAt: null, reason: "100 games in" }]);

    await user.click(screen.getByRole("button", { name: "Award Century to nyjah" }));

    await waitFor(() => expect(mockAwardAchievement).toHaveBeenCalledWith("u1", "century", "100 games in"));
    expect(await screen.findByText("Badge awarded")).toBeInTheDocument();
    expect(mockFetchAchievements).toHaveBeenCalledTimes(2);
  });

  it("offers revoke — never award — for an already-earned badge", async () => {
    const user = userEvent.setup();
    mockFetchAchievements.mockResolvedValue([{ id: "og", earnedAt: null, reason: "founding account" }]);
    await renderWithTarget(user);

    const row = within(screen.getByTestId("badge-row-og"));
    // Grants are immutable server-side, so an award affordance here could only
    // ever fail — the row must offer revoke instead.
    expect(row.queryByRole("button", { name: "Award OG to nyjah" })).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: "REVOKE" })).toBeInTheDocument();
  });

  it("confirms before revoking a badge", async () => {
    const user = userEvent.setup();
    mockFetchAchievements.mockResolvedValue([{ id: "og", earnedAt: null, reason: "founding account" }]);
    await renderWithTarget(user);

    const row = within(screen.getByTestId("badge-row-og"));
    await user.click(row.getByRole("button", { name: "REVOKE" }));
    expect(row.getByText("Revoke OG from @nyjah?")).toBeInTheDocument();
    expect(mockRevokeAchievement).not.toHaveBeenCalled();

    await user.click(row.getByRole("button", { name: "REVOKE" }));

    await waitFor(() => expect(mockRevokeAchievement).toHaveBeenCalledWith("u1", "og"));
    expect(await screen.findByText("Badge revoked")).toBeInTheDocument();
  });

  it("toasts the failure reason when a badge award is rejected", async () => {
    const user = userEvent.setup();
    mockAwardAchievement.mockRejectedValue(new Error("Missing or insufficient permissions."));
    await renderWithTarget(user);
    await user.type(screen.getByLabelText("REASON"), "100 games in");

    await user.click(screen.getByRole("button", { name: "Award Century to nyjah" }));

    expect(await screen.findByText("Award failed")).toBeInTheDocument();
    expect(screen.getByText("Missing or insufficient permissions.")).toBeInTheDocument();
  });

  it("toasts when a badge revoke is rejected", async () => {
    const user = userEvent.setup();
    mockFetchAchievements.mockResolvedValue([{ id: "og", earnedAt: null, reason: "founding account" }]);
    mockRevokeAchievement.mockRejectedValue(new Error("Missing or insufficient permissions."));
    await renderWithTarget(user);

    const row = within(screen.getByTestId("badge-row-og"));
    await user.click(row.getByRole("button", { name: "REVOKE" }));
    await user.click(row.getByRole("button", { name: "REVOKE" }));

    expect(await screen.findByText("Revoke failed")).toBeInTheDocument();
    expect(screen.getByTestId("badge-row-og")).toBeInTheDocument();
  });

  it("toasts when the badge read fails and still renders the awardable list", async () => {
    const user = userEvent.setup();
    mockFetchAchievements.mockRejectedValue(new Error("offline"));
    await renderWithTarget(user);

    expect(await screen.findByText("Couldn't load badges")).toBeInTheDocument();
    expect(screen.getByTestId("badge-row-century")).toBeInTheDocument();
  });
});

describe("AwardsPanel — locker", () => {
  it("shows an empty state for a player who owns nothing", async () => {
    const user = userEvent.setup();
    await renderWithTarget(user);

    expect(screen.getByTestId("admin-locker-empty")).toHaveTextContent("@nyjah owns nothing yet");
  });

  it("blocks minting until name and provenance are supplied", async () => {
    const user = userEvent.setup();
    await renderWithTarget(user);

    expect(screen.getByRole("button", { name: "AWARD ITEM" })).toBeDisabled();
    await user.type(screen.getByLabelText("NAME"), "Ledge Killer");
    expect(screen.getByRole("button", { name: "AWARD ITEM" })).toBeDisabled();
    await user.type(screen.getByLabelText("PROVENANCE REASON"), "Won the 2026 invitational");
    expect(screen.getByRole("button", { name: "AWARD ITEM" })).toBeEnabled();
  });

  it("mints an item from the form and collapses a blank image URL to null", async () => {
    const user = userEvent.setup();
    await renderWithTarget(user);

    await user.selectOptions(screen.getByLabelText("TYPE"), "wheels");
    await user.type(screen.getByLabelText("NAME"), " Ledge Killer ");
    await user.type(screen.getByLabelText("BRAND"), "Hubba");
    await user.selectOptions(screen.getByLabelText("RARITY"), "rare");
    await user.type(screen.getByLabelText("PROVENANCE REASON"), "Won the 2026 invitational");
    mockFetchLockerItems.mockResolvedValue([lockerItem]);

    await user.click(screen.getByRole("button", { name: "AWARD ITEM" }));

    await waitFor(() =>
      expect(mockAwardLockerItem).toHaveBeenCalledWith("u1", {
        type: "wheels",
        brand: "Hubba",
        name: "Ledge Killer",
        imageUrl: null,
        rarity: "rare",
        provenanceReason: "Won the 2026 invitational",
      }),
    );
    expect(await screen.findByText("Item awarded")).toBeInTheDocument();
    expect(await screen.findByTestId("admin-locker-item-item1")).toBeInTheDocument();
  });

  it("passes a supplied image URL through", async () => {
    const user = userEvent.setup();
    await renderWithTarget(user);

    await user.type(screen.getByLabelText("NAME"), "Ledge Killer");
    await user.type(screen.getByLabelText("IMAGE URL"), "https://cdn.example/deck.png");
    await user.type(screen.getByLabelText("PROVENANCE REASON"), "Won it");

    await user.click(screen.getByRole("button", { name: "AWARD ITEM" }));

    await waitFor(() =>
      expect(mockAwardLockerItem).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({ imageUrl: "https://cdn.example/deck.png" }),
      ),
    );
  });

  it("confirms before removing an item", async () => {
    const user = userEvent.setup();
    mockFetchLockerItems.mockResolvedValue([lockerItem]);
    await renderWithTarget(user);

    const row = within(screen.getByTestId("admin-locker-item-item1"));
    await user.click(row.getByRole("button", { name: "REMOVE" }));
    expect(row.getByText("Remove Ledge Killer from @nyjah?")).toBeInTheDocument();
    expect(mockRemoveLockerItem).not.toHaveBeenCalled();

    await user.click(row.getByRole("button", { name: "REMOVE" }));

    await waitFor(() => expect(mockRemoveLockerItem).toHaveBeenCalledWith("u1", "item1"));
    expect(await screen.findByText("Item removed")).toBeInTheDocument();
    expect(mockFetchLockerItems).toHaveBeenCalledTimes(2);
  });

  it("omits the brand separator for an item with no brand", async () => {
    const user = userEvent.setup();
    mockFetchLockerItems.mockResolvedValue([{ ...lockerItem, brand: "" }]);
    await renderWithTarget(user);

    const row = within(screen.getByTestId("admin-locker-item-item1"));
    expect(row.getByText("rare · unknown")).toBeInTheDocument();
  });

  it("toasts when removing an item fails", async () => {
    const user = userEvent.setup();
    mockFetchLockerItems.mockResolvedValue([lockerItem]);
    mockRemoveLockerItem.mockRejectedValue(new Error("Missing or insufficient permissions."));
    await renderWithTarget(user);

    const row = within(screen.getByTestId("admin-locker-item-item1"));
    await user.click(row.getByRole("button", { name: "REMOVE" }));
    await user.click(row.getByRole("button", { name: "REMOVE" }));

    expect(await screen.findByText("Remove failed")).toBeInTheDocument();
    expect(screen.getByTestId("admin-locker-item-item1")).toBeInTheDocument();
  });

  it("toasts when minting fails", async () => {
    const user = userEvent.setup();
    mockAwardLockerItem.mockRejectedValue(new Error("Missing or insufficient permissions."));
    await renderWithTarget(user);
    await user.type(screen.getByLabelText("NAME"), "Ledge Killer");
    await user.type(screen.getByLabelText("PROVENANCE REASON"), "Won it");

    await user.click(screen.getByRole("button", { name: "AWARD ITEM" }));

    expect(await screen.findByText("Award failed")).toBeInTheDocument();
  });

  it("toasts when the locker read fails", async () => {
    const user = userEvent.setup();
    mockFetchLockerItems.mockRejectedValue(new Error("offline"));
    await renderWithTarget(user);

    expect(await screen.findByText("Couldn't load locker")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { Spot } from "../../../../types/spot";
import { AddedSpotsSection } from "../AddedSpotsSection";

const listSpotsByCreator = vi.fn();

vi.mock("../../../../services/spots", () => ({
  listSpotsByCreator: (...args: unknown[]) => listSpotsByCreator(...args),
}));

function spot(id: string, name: string): Spot {
  return {
    id,
    createdBy: "me",
    name,
    description: null,
    latitude: 1,
    longitude: 2,
    gnarRating: 3,
    bustRisk: 2,
    obstacles: [],
    photoUrls: [],
    isVerified: false,
    isActive: true,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
}

function renderSection(onAddSpot?: () => void) {
  return render(
    <MemoryRouter>
      <AddedSpotsSection uid="me" onAddSpot={onAddSpot} />
    </MemoryRouter>,
  );
}

describe("AddedSpotsSection", () => {
  beforeEach(() => {
    listSpotsByCreator.mockReset();
  });

  it("keeps the empty state when the player has added no spots", async () => {
    listSpotsByCreator.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByTestId("added-spots-placeholder")).toBeInTheDocument();
    expect(screen.getByText(/Add spots to see them here/i)).toBeInTheDocument();
    expect(listSpotsByCreator).toHaveBeenCalledWith("me");
  });

  it("links each spot card to /spots/:id", async () => {
    listSpotsByCreator.mockResolvedValue([spot("hubba-1", "Hollenbeck Hubba"), spot("ledge-2", "School Ledge")]);
    renderSection();
    const first = await screen.findByRole("link", { name: "Hollenbeck Hubba" });
    const second = screen.getByRole("link", { name: "School Ledge" });
    expect(first).toHaveAttribute("href", "/spots/hubba-1");
    expect(second).toHaveAttribute("href", "/spots/ledge-2");
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
  });

  it("still offers ADD A SPOT when the list has spots", async () => {
    const user = userEvent.setup();
    const onAddSpot = vi.fn();
    listSpotsByCreator.mockResolvedValue([spot("hubba-1", "Hollenbeck Hubba")]);
    renderSection(onAddSpot);
    await user.click(await screen.findByRole("button", { name: /add a spot/i }));
    expect(onAddSpot).toHaveBeenCalledTimes(1);
  });

  it("disables ADD A SPOT on a populated list when navigation is unwired", async () => {
    listSpotsByCreator.mockResolvedValue([spot("hubba-1", "Hollenbeck Hubba")]);
    renderSection();
    expect(await screen.findByRole("button", { name: /add a spot/i })).toBeDisabled();
  });

  it("ignores a response that arrives after the section unmounts", async () => {
    let resolveRows: (rows: Spot[]) => void = () => {};
    listSpotsByCreator.mockReturnValue(
      new Promise<Spot[]>((resolve) => {
        resolveRows = resolve;
      }),
    );
    const { unmount } = renderSection();
    expect(screen.getByTestId("added-spots-loading")).toBeInTheDocument();
    unmount();
    resolveRows([spot("hubba-1", "Hollenbeck Hubba")]);
    await Promise.resolve();
  });

  it("does not claim the list is empty when the read fails", async () => {
    listSpotsByCreator.mockRejectedValue(new Error("permission-denied"));
    renderSection();
    expect(await screen.findByTestId("added-spots-error")).toBeInTheDocument();
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

  describe("when the viewed player changes while the old read is in flight", () => {
    function holdRead() {
      const held: { resolve: (rows: Spot[]) => void; reject: (err: Error) => void } = {
        resolve: () => {},
        reject: () => {},
      };
      listSpotsByCreator.mockReturnValueOnce(
        new Promise<Spot[]>((resolve, reject) => {
          held.resolve = resolve;
          held.reject = reject;
        }),
      );
      return held;
    }

    const section = (uid: string) => (
      <MemoryRouter>
        <AddedSpotsSection uid={uid} />
      </MemoryRouter>
    );

    it("keeps the new player's spots when the old read fails late", async () => {
      const old = holdRead();
      const { rerender } = render(section("a"));
      expect(screen.getByTestId("added-spots-loading")).toBeInTheDocument();
      listSpotsByCreator.mockResolvedValueOnce([spot("ledge-2", "School Ledge")]);
      rerender(section("b"));
      expect(await screen.findByRole("link", { name: "School Ledge" })).toBeInTheDocument();
      await act(async () => old.reject(new Error("permission-denied")));
      expect(screen.getByRole("link", { name: "School Ledge" })).toBeInTheDocument();
      expect(screen.queryByTestId("added-spots-error")).not.toBeInTheDocument();
      expect(listSpotsByCreator.mock.calls).toEqual([["a"], ["b"]]);
    });

    it("keeps the new player's empty list when the old read lands late", async () => {
      const old = holdRead();
      const { rerender } = render(section("a"));
      listSpotsByCreator.mockResolvedValueOnce([]);
      rerender(section("b"));
      expect(await screen.findByTestId("added-spots-placeholder")).toBeInTheDocument();
      await act(async () => old.resolve([spot("hubba-1", "Hollenbeck Hubba")]));
      expect(screen.getByTestId("added-spots-placeholder")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Hollenbeck Hubba" })).not.toBeInTheDocument();
    });
  });

  it("does not claim the list is empty when the read fails", async () => {
    listSpotsByCreator.mockRejectedValue(new Error("permission-denied"));
    renderSection();
    expect(await screen.findByTestId("added-spots-error")).toBeInTheDocument();
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
  });
});

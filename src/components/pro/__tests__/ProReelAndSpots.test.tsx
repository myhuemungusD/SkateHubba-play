import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const h = vi.hoisted(() => ({ reel: vi.fn(), spots: vi.fn() }));
vi.mock("../../../services/proShowcase", () => ({ fetchProClipReel: h.reel, fetchProSpots: h.spots }));

import { ProReelAndSpots } from "../ProReelAndSpots";

const c = (id: string, thumb: string | null = null) => ({
  id,
  trickName: `trick ${id}`,
  videoUrl: "v",
  thumbnailUrl: thumb,
});
const ui = (isOwn = false) =>
  render(
    <MemoryRouter>
      <ProReelAndSpots uid="p" displayName="Mike White" isOwn={isOwn} />
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe("ProReelAndSpots", () => {
  it("shows loading, then pinned clips and spots linked to the map", async () => {
    h.reel.mockResolvedValue([c("a", "t.jpg"), c("b")]);
    h.spots.mockResolvedValue([
      { spot: { id: "s1", name: "El Toro" }, recommended: true, clips: [c("x")] },
      { spot: { id: "s2", name: "Cherry Park" }, recommended: false, clips: [] },
      { spot: { id: "s3", name: "Berrics" }, recommended: false, clips: [c("y"), c("z")] },
    ]);
    ui();
    expect(screen.getByText("Loading clips…")).toBeInTheDocument();
    expect(screen.getByText("Loading spots…")).toBeInTheDocument();
    expect(await screen.findByLabelText("trick a")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "El Toro" })).toHaveAttribute("href", "/spots/s1");
    expect(screen.getByText("Recommended · 1 clip")).toBeInTheDocument();
    expect(screen.getByText("0 clips")).toBeInTheDocument();
    expect(screen.getByText("2 clips")).toBeInTheDocument();
  });

  it("explains empty sections to visitors", async () => {
    h.reel.mockResolvedValue([]);
    h.spots.mockResolvedValue([]);
    ui();
    expect(await screen.findByText("Mike White hasn't pinned any clips yet.")).toBeInTheDocument();
    expect(await screen.findByText("Mike White hasn't shared any spots yet.")).toBeInTheDocument();
  });

  it("tells the pro how to fill empty sections", async () => {
    h.reel.mockResolvedValue([]);
    h.spots.mockResolvedValue([]);
    ui(true);
    expect(await screen.findByText(/Pin up to 3 of your best clips/)).toBeInTheDocument();
    expect(await screen.findByText(/Add a spot on the map/)).toBeInTheDocument();
  });

  it("ignores results after unmount", async () => {
    let done: (v: unknown) => void = () => {};
    h.reel.mockReturnValue(new Promise((r) => (done = r)));
    h.spots.mockReturnValue(new Promise(() => {}));
    const { unmount } = ui();
    unmount();
    done([]);
    await Promise.resolve();
  });
});

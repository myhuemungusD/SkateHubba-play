import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OwnClipModeration } from "../OwnClipModeration";

const fetchOwn = vi.fn();

vi.mock("../../../services/clipModeration", () => ({
  fetchOwnClipModeration: (...args: unknown[]) => fetchOwn(...args),
}));

function renderStrip(refreshKey = 0) {
  return render(
    <MemoryRouter>
      <OwnClipModeration uid="me" refreshKey={refreshKey} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  fetchOwn.mockResolvedValue([]);
});

describe("OwnClipModeration", () => {
  it("renders nothing while the flag is off", () => {
    renderStrip();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(fetchOwn).not.toHaveBeenCalled();
  });

  it("shows a checking clip and an appeal link", async () => {
    vi.stubEnv("VITE_FEATURE_CLIP_MODERATION_ENABLED", "true");
    fetchOwn.mockResolvedValue([
      { id: "c1", trickName: "ollie", moderation: "pending", statement: "Checking…", appealPath: null },
      {
        id: "c2",
        trickName: "heel",
        moderation: "rejected",
        statement: "Too explicit.",
        appealPath: "/appeal/c2",
      },
    ]);
    renderStrip();
    expect(await screen.findByText("Checking…")).toBeInTheDocument();
    expect(screen.getByText("Too explicit.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Appeal" })).toHaveAttribute("href", "/appeal/c2");
  });

  it("ignores a response that arrives after the strip unmounts", async () => {
    vi.stubEnv("VITE_FEATURE_CLIP_MODERATION_ENABLED", "true");
    let resolveRows: (rows: unknown[]) => void = () => {};
    fetchOwn.mockReturnValue(
      new Promise((resolve) => {
        resolveRows = resolve;
      }),
    );
    const { unmount } = renderStrip();
    unmount();
    resolveRows([{ id: "c1", trickName: "ollie", moderation: "pending", statement: "Checking…", appealPath: null }]);
    await waitFor(() => expect(fetchOwn).toHaveBeenCalled());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("clears the list when the read fails", async () => {
    vi.stubEnv("VITE_FEATURE_CLIP_MODERATION_ENABLED", "true");
    fetchOwn.mockRejectedValue(new Error("offline"));
    renderStrip(1);
    await waitFor(() => expect(fetchOwn).toHaveBeenCalledWith("me"));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

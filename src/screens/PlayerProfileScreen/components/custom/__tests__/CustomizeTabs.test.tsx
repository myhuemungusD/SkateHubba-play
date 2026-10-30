import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_PROFILE_CUSTOM, type PinnableClip } from "../../../../../services/profileCustom";

const m = vi.hoisted(() => ({ pinnable: vi.fn() }));
vi.mock("../../../../../services/profileCustom", async (orig) => ({
  ...(await orig<typeof import("../../../../../services/profileCustom")>()),
  fetchPinnableClips: m.pinnable,
}));

import { CustomizeAboutTab } from "../CustomizeAboutTab";
import { CustomizeLookTab } from "../CustomizeLookTab";
import { CustomizeLayoutTab } from "../CustomizeLayoutTab";

function sponsorAdd() {
  const row = screen.getByRole("textbox", { name: "Sponsor URL" }).parentElement!;
  return within(row).getByRole("button", { name: "ADD" });
}

describe("CustomizeAboutTab sponsor URL", () => {
  it("only accepts a sponsor whose optional URL is an allowed link", () => {
    const set = vi.fn();
    render(<CustomizeAboutTab draft={DEFAULT_PROFILE_CUSTOM} set={set} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Sponsor name" }), { target: { value: "Shop" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Sponsor URL" }), {
      target: { value: "https://shop.example.com" },
    });
    expect(sponsorAdd()).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Sponsor URL" }), {
      target: { value: " https://www.instagram.com/shop " },
    });
    expect(sponsorAdd()).toBeEnabled();
    fireEvent.click(sponsorAdd());
    expect(set).toHaveBeenCalledWith("sponsors", [{ name: "Shop", url: "https://www.instagram.com/shop" }]);
    expect(screen.getByRole("textbox", { name: "Sponsor URL" })).toHaveValue("");
  });
});

describe("CustomizeLookTab", () => {
  it("writes the gradient bottom colour from its own row", () => {
    const set = vi.fn();
    render(<CustomizeLookTab draft={DEFAULT_PROFILE_CUSTOM} set={set} />);
    fireEvent.click(screen.getByRole("button", { name: "Gradient bottom #0A84FF" }));
    expect(set).toHaveBeenCalledWith("gradientTo", "#0A84FF");
  });
});

describe("CustomizeLayoutTab", () => {
  beforeEach(() => {
    m.pinnable.mockReset();
  });

  it("lists the player's clips once they load", async () => {
    m.pinnable.mockResolvedValue([{ id: "c1", trickName: "Tre flip", videoUrl: "v.mp4", thumbnailUrl: null }]);
    render(<CustomizeLayoutTab uid="u1" draft={DEFAULT_PROFILE_CUSTOM} set={vi.fn()} />);
    expect(await screen.findByText("Tre flip")).toBeInTheDocument();
    expect(m.pinnable).toHaveBeenCalledWith("u1");
  });

  it("keeps the newer player's clips when an older read lands late", async () => {
    let finishOld: (c: PinnableClip[]) => void = () => {};
    m.pinnable.mockReturnValueOnce(new Promise<PinnableClip[]>((ok) => (finishOld = ok)));
    const { rerender } = render(<CustomizeLayoutTab uid="u1" draft={DEFAULT_PROFILE_CUSTOM} set={vi.fn()} />);
    m.pinnable.mockResolvedValueOnce([{ id: "c2", trickName: "Kickflip", videoUrl: "k.mp4", thumbnailUrl: null }]);
    rerender(<CustomizeLayoutTab uid="u2" draft={DEFAULT_PROFILE_CUSTOM} set={vi.fn()} />);
    expect(await screen.findByText("Kickflip")).toBeInTheDocument();
    await act(async () => finishOld([{ id: "c1", trickName: "Tre flip", videoUrl: "v.mp4", thumbnailUrl: null }]));
    expect(screen.getByText("Kickflip")).toBeInTheDocument();
    expect(screen.queryByText("Tre flip")).toBeNull();
    expect(m.pinnable.mock.calls).toEqual([["u1"], ["u2"]]);
  });
});

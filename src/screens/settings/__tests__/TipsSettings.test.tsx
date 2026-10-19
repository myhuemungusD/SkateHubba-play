import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { ctx } = vi.hoisted(() => ({
  ctx: {
    current: { available: true, disabled: false, setDisabled: vi.fn(), replay: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock("../../../context/TipsContext", () => ({ useTipsContext: () => ctx.current }));

import { TipsSettings } from "../TipsSettings";

describe("TipsSettings", () => {
  it("renders nothing when tips are unavailable", () => {
    ctx.current = { ...ctx.current, available: false };
    const { container } = render(<TipsSettings />);
    expect(container).toBeEmptyDOMElement();
    ctx.current = { ...ctx.current, available: true };
  });

  it("switches tips off and replays them", () => {
    render(<TipsSettings />);
    const sw = screen.getByRole("switch", { name: "Show tips" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(ctx.current.setDisabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /replay tips/i }));
    expect(ctx.current.replay).toHaveBeenCalled();
    expect(screen.getByText(/tips will show again/i)).toBeInTheDocument();
  });
});

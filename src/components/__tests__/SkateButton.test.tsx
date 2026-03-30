import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkateButton } from "../SkateButton";

const mockPlayOlliePop = vi.fn();

vi.mock("../../utils/ollieSound", () => ({
  playOlliePop: () => mockPlayOlliePop(),
}));

describe("SkateButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children text", () => {
    render(<SkateButton>Kickflip</SkateButton>);
    expect(screen.getByRole("button", { name: "Kickflip" })).toBeInTheDocument();
  });

  it("calls onClick and plays sound on click", async () => {
    const onClick = vi.fn();
    render(<SkateButton onClick={onClick}>Go</SkateButton>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(mockPlayOlliePop).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <SkateButton onClick={onClick} disabled>
        Nope
      </SkateButton>,
    );
    const btn = screen.getByRole("button", { name: "Nope" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(mockPlayOlliePop).not.toHaveBeenCalled();
  });

  it("applies custom className", () => {
    render(<SkateButton className="mt-4">Styled</SkateButton>);
    expect(screen.getByRole("button", { name: "Styled" })).toHaveClass("mt-4");
  });

  it("renders SVG deck shape", () => {
    const { container } = render(<SkateButton>Deck</SkateButton>);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("works without onClick prop", async () => {
    render(<SkateButton>Solo</SkateButton>);
    await userEvent.click(screen.getByRole("button", { name: "Solo" }));
    expect(mockPlayOlliePop).toHaveBeenCalledTimes(1);
  });
});

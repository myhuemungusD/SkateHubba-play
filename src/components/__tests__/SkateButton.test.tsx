import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkateButton } from "../SkateButton";

const mockPlayOlliePop = vi.fn();

vi.mock("../../utils/ollieSound", () => ({
  playOlliePop: () => mockPlayOlliePop(),
}));

const mockPlayHaptic = vi.fn();

vi.mock("../../services/haptics", () => ({
  playHaptic: (...args: unknown[]) => mockPlayHaptic(...args),
  // Mirror the real table: primary intent → medium `"button_primary"`.
  hapticForVariant: (variant: string | null | undefined) => {
    if (variant == null) return "button_primary";
    const table: Record<string, string> = {
      primary: "button_primary",
      success: "button_primary",
      danger: "button_primary",
      secondary: "toast",
      ghost: "toast",
    };
    return table[variant] ?? "toast";
  },
}));

describe("SkateButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children text", () => {
    render(<SkateButton>Kickflip</SkateButton>);
    expect(screen.getByRole("button", { name: "Kickflip" })).toBeInTheDocument();
  });

  it("calls onClick and plays sound + haptic on click", async () => {
    vi.useRealTimers();
    const onClick = vi.fn();
    render(<SkateButton onClick={onClick}>Go</SkateButton>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(mockPlayOlliePop).toHaveBeenCalledTimes(1);
    expect(mockPlayHaptic).toHaveBeenCalledWith("button_primary");
  });

  it("applies animate-ollie class on click and removes it after 500ms", () => {
    const { container } = render(<SkateButton>Pop</SkateButton>);
    const animDiv = container.querySelector("button > div")!;

    fireEvent.click(screen.getByRole("button", { name: "Pop" }));
    expect(animDiv.className).toContain("animate-ollie");

    act(() => vi.advanceTimersByTime(500));
    expect(animDiv.className).not.toContain("animate-ollie");
  });

  it("does not fire onClick or sound when disabled (manual guard)", () => {
    const onClick = vi.fn();
    render(
      <SkateButton onClick={onClick} disabled>
        Nope
      </SkateButton>,
    );
    const btn = screen.getByRole("button", { name: "Nope" });
    expect(btn).toBeDisabled();

    // fireEvent bypasses the HTML disabled attribute, testing the manual guard
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(mockPlayOlliePop).not.toHaveBeenCalled();
    expect(mockPlayHaptic).not.toHaveBeenCalled();
  });

  it("does not throw when unmounted during animation timeout", () => {
    const { unmount } = render(<SkateButton>Bail</SkateButton>);
    fireEvent.click(screen.getByRole("button", { name: "Bail" }));
    unmount();
    // Flush the 500ms setTimeout — should not throw on unmounted component
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
  });

  it("applies custom className", () => {
    render(<SkateButton className="mt-4">Styled</SkateButton>);
    expect(screen.getByRole("button", { name: "Styled" })).toHaveClass("mt-4");
  });

  it("renders SVG with aria-hidden", () => {
    const { container } = render(<SkateButton>Deck</SkateButton>);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("works without onClick prop", () => {
    render(<SkateButton>Solo</SkateButton>);
    fireEvent.click(screen.getByRole("button", { name: "Solo" }));
    expect(mockPlayOlliePop).toHaveBeenCalledTimes(1);
  });
});

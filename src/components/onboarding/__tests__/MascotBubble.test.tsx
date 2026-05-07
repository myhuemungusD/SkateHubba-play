import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MascotBubble } from "../MascotBubble";

vi.mock("../../../services/haptics", () => ({
  playHaptic: vi.fn(),
}));

import { playHaptic } from "../../../services/haptics";

function defaultProps() {
  return {
    title: "your tag",
    message: "pick a name.",
    stepLabel: "Step 2 of 5",
    stepIndex: 1,
    totalSteps: 5,
    primaryCta: { label: "got it", onClick: vi.fn() },
    reducedMotion: false,
  };
}

describe("MascotBubble", () => {
  it("renders the title, message, and step label", () => {
    render(<MascotBubble {...defaultProps()} />);
    expect(screen.getByRole("heading", { name: /your tag/i })).toBeInTheDocument();
    expect(screen.getByText("pick a name.")).toBeInTheDocument();
    expect(screen.getAllByText(/step 2 of 5/i).length).toBeGreaterThan(0);
  });

  it("invokes primaryCta.onClick when the primary button is clicked", async () => {
    const onClick = vi.fn();
    render(<MascotBubble {...defaultProps()} primaryCta={{ label: "go", onClick }} />);
    await userEvent.click(screen.getByRole("button", { name: /^go$/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(playHaptic).toHaveBeenCalledWith("button_primary");
  });

  it("renders the skip button when onSkip is supplied and invokes it on click", async () => {
    const onSkip = vi.fn();
    render(<MascotBubble {...defaultProps()} onSkip={onSkip} />);
    await userEvent.click(screen.getByRole("button", { name: /^skip$/ }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("hides the skip button when onSkip is omitted", () => {
    render(<MascotBubble {...defaultProps()} />);
    expect(screen.queryByRole("button", { name: /^skip$/ })).toBeNull();
  });

  it("renders the back button only when onBack is provided", async () => {
    const onBack = vi.fn();
    const { rerender } = render(<MascotBubble {...defaultProps()} />);
    expect(screen.queryByRole("button", { name: /^back$/ })).toBeNull();

    rerender(<MascotBubble {...defaultProps()} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /^back$/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the close button when onClose is provided and fires it on click", async () => {
    const onClose = vi.fn();
    render(<MascotBubble {...defaultProps()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close tour/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the close button when onClose is omitted", () => {
    render(<MascotBubble {...defaultProps()} />);
    expect(screen.queryByRole("button", { name: /close tour/i })).toBeNull();
  });

  it("exposes a polite live region announcing step changes", () => {
    render(<MascotBubble {...defaultProps()} />);
    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent(/step 2 of 5/i);
  });

  it("renders a progressbar with the correct aria-valuenow / max", () => {
    render(<MascotBubble {...defaultProps()} stepIndex={2} totalSteps={5} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
  });

  it("omits the entrance animation class when reducedMotion is true", () => {
    const { container } = render(<MascotBubble {...defaultProps()} reducedMotion />);
    const bubble = container.querySelector('[data-testid="mascot-bubble"]');
    expect(bubble?.className).not.toContain("animate-scale-in");
  });
});

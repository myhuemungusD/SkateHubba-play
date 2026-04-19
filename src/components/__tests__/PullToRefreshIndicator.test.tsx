import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PullToRefreshIndicator } from "../PullToRefreshIndicator";

describe("PullToRefreshIndicator", () => {
  it("renders nothing when idle and offset is zero", () => {
    const { container } = render(<PullToRefreshIndicator offset={0} state="idle" triggerReached={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the pull-to-refresh label while pulling", () => {
    render(<PullToRefreshIndicator offset={30} state="pulling" triggerReached={false} />);
    expect(screen.getByText("Pull to refresh")).toBeInTheDocument();
    // Arrow icon is present (role=status wrapper has the rotated arrow inside).
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("switches the copy once the threshold is crossed", () => {
    render(<PullToRefreshIndicator offset={90} state="ready" triggerReached={true} />);
    expect(screen.getByText("Release to refresh")).toBeInTheDocument();
  });

  it("renders a spinner and the refreshing label during refresh", () => {
    render(<PullToRefreshIndicator offset={72} state="refreshing" triggerReached={true} />);
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    // No chevron in refreshing mode — arrow SVG is replaced by spinner.
    expect(screen.queryByRole("img", { hidden: true })).not.toBeInTheDocument();
  });

  it("applies announcing role so screen readers pick up state changes", () => {
    render(<PullToRefreshIndicator offset={40} state="pulling" triggerReached={false} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("remains rendered when offset > 0 even if state already returned to idle", () => {
    render(<PullToRefreshIndicator offset={10} state="idle" triggerReached={false} />);
    // During the snap-back animation the indicator should not vanish abruptly.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

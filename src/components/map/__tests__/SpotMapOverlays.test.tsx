import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapLoadTimeoutOverlay, MapToast, SpotMapUnavailable } from "../SpotMapOverlays";

const originalLocation = window.location;

function swapLocation(reload: () => void) {
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
}

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("SpotMapOverlays", () => {
  it("reloads the page from either Retry button when no onRetry handler is given", () => {
    const reload = vi.fn();
    swapLocation(reload);
    const { unmount } = render(<SpotMapUnavailable />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Use list view" })).toBeNull();
    unmount();

    render(<MapLoadTimeoutOverlay />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("announces a toast message politely", () => {
    render(<MapToast message="Waiting for location…" />);
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Waiting for location…");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });
});

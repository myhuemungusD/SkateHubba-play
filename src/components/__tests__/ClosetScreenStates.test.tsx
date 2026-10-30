import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClosetGatedState, ClosetLoadErrorState, ClosetLoadingState } from "../ClosetScreenStates";

describe("ClosetScreenStates", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: originalLocation });
  });

  it("ClosetGatedState shows the gate message and no actions", () => {
    render(<ClosetGatedState message="Drop Day is coming soon." />);
    expect(screen.getByText("Drop Day is coming soon.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ClosetLoadingState renders only a spinner", () => {
    const { container } = render(<ClosetLoadingState />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("ClosetLoadErrorState shows the error and reloads the page on Retry", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, reload },
    });
    render(<ClosetLoadErrorState message="Couldn't load the drop." />);
    expect(screen.getByText("Couldn't load the drop.")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

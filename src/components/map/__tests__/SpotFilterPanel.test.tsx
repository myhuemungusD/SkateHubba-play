import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SpotFilterPanel } from "../SpotFilterPanel";
import { DEFAULT_SPOT_FILTERS, type SpotFilters } from "../spotFilters";

function renderPanel(filters: SpotFilters = DEFAULT_SPOT_FILTERS, active = 0) {
  const props = { onChange: vi.fn(), toggleObstacle: vi.fn(), reset: vi.fn(), onDone: vi.fn() };
  render(<SpotFilterPanel filters={filters} active={active} {...props} />);
  return props;
}

describe("SpotFilterPanel", () => {
  it("sets the minimum gnar and toggles verified-only on", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "4+" }));
    expect(props.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SPOT_FILTERS, minGnar: 4 });
    fireEvent.click(screen.getByRole("switch"));
    expect(props.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SPOT_FILTERS, verifiedOnly: true });
  });

  it("reflects active filters, toggles verified-only off, resets and closes", () => {
    const filters: SpotFilters = { ...DEFAULT_SPOT_FILTERS, minGnar: 5, verifiedOnly: true, obstacles: ["rail"] };
    const props = renderPanel(filters, 3);
    expect(screen.getByRole("button", { name: "5+" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "rail" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("switch"));
    expect(props.onChange).toHaveBeenLastCalledWith({ ...filters, verifiedOnly: false });
    fireEvent.click(screen.getByRole("button", { name: "rail" }));
    expect(props.toggleObstacle).toHaveBeenCalledWith("rail");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(props.reset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });
});

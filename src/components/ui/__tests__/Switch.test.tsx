import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "../Switch";

describe("Switch", () => {
  it("is a 44px named switch that reports the next value", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch checked={false} onChange={onChange} label="Public" />);
    const toggle = screen.getByRole("switch", { name: "Public" });
    expect(toggle).toHaveClass("min-h-[44px]", "min-w-[44px]");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<Switch checked onChange={onChange} label="Public" />);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("does nothing while disabled", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Sounds" disabled />);
    await userEvent.click(screen.getByRole("switch", { name: "Sounds" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

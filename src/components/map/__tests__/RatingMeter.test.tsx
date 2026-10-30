import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Flame } from "lucide-react";
import { RatingMeter } from "../RatingMeter";

const COLOR = "#123456";

function renderMeter(props: Partial<Parameters<typeof RatingMeter>[0]> = {}) {
  return render(<RatingMeter value={3} Icon={Flame} color={COLOR} label="Heat" unit="flame" {...props} />);
}

function icons(): SVGElement[] {
  return screen.getAllByRole("button").map((b) => b.querySelector("svg") as SVGElement);
}

describe("RatingMeter", () => {
  it("labels the group with the value and each button with a pluralized unit", () => {
    renderMeter();
    expect(screen.getByRole("group", { name: "Heat: 3 of 5" })).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "1 flame",
      "2 flames",
      "3 flames",
      "4 flames",
      "5 flames",
    ]);
  });

  it("fills icons up to the value and leaves the rest outlined", () => {
    renderMeter({ value: 2 });
    expect(icons().map((svg) => svg.getAttribute("fill"))).toEqual([COLOR, COLOR, "none", "none", "none"]);
    expect(icons().map((svg) => svg.getAttribute("stroke"))).toEqual([
      COLOR,
      COLOR,
      "currentColor",
      "currentColor",
      "currentColor",
    ]);
  });

  it("is read-only by default: buttons are disabled and clicks do nothing", () => {
    const onChange = vi.fn();
    renderMeter({ onChange });
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      expect(button).toHaveClass("cursor-default");
    }
    fireEvent.click(screen.getByRole("button", { name: "5 flames" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports the clicked value when editable", () => {
    const onChange = vi.fn();
    renderMeter({ readonly: false, onChange });
    const button = screen.getByRole("button", { name: "4 flames" });
    expect(button).toBeEnabled();
    expect(button).toHaveClass("cursor-pointer");
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("tolerates a click with no onChange handler", () => {
    renderMeter({ readonly: false });
    fireEvent.click(screen.getByRole("button", { name: "1 flame" }));
    expect(screen.getByRole("group", { name: "Heat: 3 of 5" })).toBeInTheDocument();
  });

  it("sizes icons 18px by default and 14px for sm", () => {
    const { unmount } = renderMeter();
    expect(icons()[0].getAttribute("width")).toBe("18");
    unmount();
    renderMeter({ size: "sm" });
    expect(icons()[0].getAttribute("width")).toBe("14");
  });
});

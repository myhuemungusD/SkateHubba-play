import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShoeDetailSheet } from "../ShoeDetailSheet";
import { MIKE_WHITE_DESIGNER_CREDIT } from "../../lib/closet/mikeWhiteCollection";

function setup() {
  const onClose = vi.fn();
  render(
    <ShoeDetailSheet
      itemDefId="mike_white_teeth_fire"
      name="Teeth — Fire Red"
      credit={MIKE_WHITE_DESIGNER_CREDIT}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("ShoeDetailSheet", () => {
  it("shows the shoe with Mike's credit and signature", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Teeth — Fire Red" });
    expect(dialog).toHaveTextContent("Designed by Mike White");
    expect(screen.getByAltText("Mike White signature")).toBeInTheDocument();
    expect(screen.getByTestId("shoe360-fallback")).toHaveAttribute(
      "src",
      "/assets/closet/mike-white/card/teeth-fire.webp",
    );
  });

  it("closes on the button, Escape and the backdrop, not on the sheet", () => {
    const onClose = setup();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

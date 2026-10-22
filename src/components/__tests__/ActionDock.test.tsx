import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActionDock } from "../ActionDock";

describe("ActionDock", () => {
  it("pins its children in the bottom action bar", () => {
    render(
      <ActionDock testId="dock">
        <button type="button">Landed</button>
      </ActionDock>,
    );
    const dock = screen.getByTestId("dock");
    expect(dock).toHaveClass("action-dock");
    expect(screen.getByRole("button", { name: "Landed" })).toBeInTheDocument();
  });

  it("drops the fixed position when a screen pins it inside its own group", () => {
    render(
      <ActionDock testId="dock" inline>
        <button type="button">Roll</button>
      </ActionDock>,
    );
    expect(screen.getByTestId("dock")).toHaveClass("action-dock", "action-dock-inline");
  });
});

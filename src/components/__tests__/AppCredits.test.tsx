import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppCredits } from "../AppCredits";

describe("AppCredits", () => {
  it("credits Mike White for the collection and the studio templates", () => {
    render(<AppCredits />);
    expect(screen.getByText("Mike White")).toBeInTheDocument();
    expect(screen.getByTestId("app-credits")).toHaveTextContent("Based on a Mike White design");
  });

  it("carries the CC BY attributions for the bundled 3D models and the CC0 sources", () => {
    render(<AppCredits />);
    const list = screen.getByTestId("app-credits");
    for (const who of ["rhcreations", "CrazyScans", "bralunit", "Poly Haven", "ambientCG"]) {
      expect(screen.getByText(who)).toBeInTheDocument();
    }
    expect(list).toHaveTextContent('"Skatepark Obstacles"');
    expect(list).toHaveTextContent("licensed under CC-BY-4.0");
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppCredits } from "../AppCredits";

describe("AppCredits", () => {
  it("credits Mike White for the collection and the studio templates", () => {
    render(<AppCredits />);
    expect(screen.getByText("Mike White")).toBeInTheDocument();
    expect(screen.getByTestId("app-credits")).toHaveTextContent("Based on a Mike White design");
  });
});

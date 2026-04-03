import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "../Spinner";

describe("Spinner", () => {
  it("renders with loading status and aria-label", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-label", "Loading");
  });

  it("displays brand logo", () => {
    render(<Spinner />);
    expect(screen.getByAltText("SkateHubba")).toBeInTheDocument();
  });
});

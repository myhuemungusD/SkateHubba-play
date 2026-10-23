import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecordFigure } from "../RecordFigure";

describe("RecordFigure", () => {
  it("shows the two numbers visually and the explicit label to screen readers", () => {
    render(<RecordFigure wins={2} games={4} testId="rec" />);
    const el = screen.getByTestId("rec");
    expect(el).toHaveTextContent("2 / 4");
    expect(el).not.toHaveTextContent(/\dW|\dL|games? played/);
    expect(screen.getByText("2 / 4")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("2 wins out of 4 games")).toHaveClass("sr-only");
    expect(el).toHaveAttribute("title", "2 wins out of 4 games");
  });

  it("renders the optional muted caption inside the hidden visual part", () => {
    render(<RecordFigure wins={1} games={3} caption="won" testId="rec" />);
    const caption = screen.getByText("won");
    expect(caption).toHaveClass("text-subtle");
    expect(caption.closest("[aria-hidden]")).not.toBeNull();
  });
});

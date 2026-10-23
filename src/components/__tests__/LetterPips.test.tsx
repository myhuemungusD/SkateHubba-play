import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LetterPips, lettersLabel } from "../LetterPips";

describe("lettersLabel", () => {
  it("spells the earned letters and the count", () => {
    expect(lettersLabel(0)).toBe("no letters, 0 of 5");
    expect(lettersLabel(2)).toBe("S K, 2 of 5");
    expect(lettersLabel(5)).toBe("S K A T E, 5 of 5");
  });
});

describe("LetterPips", () => {
  it("marks earned letters so the score reads by shape, not only colour", () => {
    const { container } = render(<LetterPips count={3} label="You" />);
    expect(screen.getByRole("img", { name: "You: S K A, 3 of 5" })).toBeInTheDocument();
    const earned = [...container.querySelectorAll("[data-earned]")].map((el) => el.getAttribute("data-earned"));
    expect(earned).toEqual(["true", "true", "true", "false", "false"]);
  });

  it("supports the large size", () => {
    const { container } = render(<LetterPips count={0} label="Them" size="lg" />);
    expect(container.querySelector("[data-earned]")).toHaveClass("h-8");
  });

  it("supports the md size between sm and lg", () => {
    const { container } = render(<LetterPips count={0} label="Them" size="md" />);
    expect(container.querySelector("[data-earned]")).toHaveClass("h-6", "min-w-6", "text-base");
  });

  it("never shrinks its row below the five pips", () => {
    render(<LetterPips count={1} label="You" />);
    expect(screen.getByRole("img", { name: /^You:/ })).toHaveClass("shrink-0");
  });
});

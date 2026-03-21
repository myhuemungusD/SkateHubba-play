import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LetterDisplay } from "../LetterDisplay";

describe("LetterDisplay", () => {
  it("renders player name and S.K.A.T.E. letters", () => {
    render(<LetterDisplay count={0} name="sk8r" />);
    expect(screen.getByText("sk8r")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("E")).toBeInTheDocument();
  });

  it("includes letter sequence in aria-label", () => {
    const { container } = render(<LetterDisplay count={2} name="sk8r" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("aria-label")).toContain("S.K.");
  });

  it("shows no letters label when count is 0", () => {
    const { container } = render(<LetterDisplay count={0} name="sk8r" />);
    expect(container.firstElementChild!.getAttribute("aria-label")).toContain("no letters");
  });
});

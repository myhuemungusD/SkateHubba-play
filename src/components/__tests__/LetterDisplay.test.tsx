import { describe, it, expect, afterEach, vi } from "vitest";
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
    render(<LetterDisplay count={2} name="sk8r" />);
    expect(screen.getByRole("img", { name: "sk8r: S K, 2 of 5" })).toBeInTheDocument();
  });

  it("shows no letters label when count is 0", () => {
    render(<LetterDisplay count={0} name="sk8r" />);
    expect(screen.getByRole("img", { name: "sk8r: no letters, 0 of 5" })).toBeInTheDocument();
  });

  it("lights the active card with its turn label and clock", () => {
    render(
      <LetterDisplay count={1} name="@me" active turnLabel="YOUR MOVE" deadline={Date.now() + 60_000} testId="me" />,
    );
    expect(screen.getByTestId("me")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("YOUR MOVE")).toBeInTheDocument();
    expect(screen.getByText("@me")).toHaveClass("text-white");
  });

  it("keeps the inactive card quiet with no label", () => {
    render(<LetterDisplay count={1} name="@them" turnLabel="THEIR MOVE" testId="them" />);
    expect(screen.getByTestId("them")).toHaveAttribute("data-active", "false");
    expect(screen.queryByText("THEIR MOVE")).not.toBeInTheDocument();
  });

  describe("Verified Pro shimmer (feature freeze)", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("suppresses the gold treatment while extras are frozen (flag unset)", () => {
      render(<LetterDisplay count={1} name="@pro" isVerifiedPro />);
      expect(screen.getByText("@pro")).not.toHaveClass("pro-username");
    });

    it("applies the gold treatment when extras are enabled", () => {
      vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
      render(<LetterDisplay count={1} name="@pro" isVerifiedPro />);
      expect(screen.getByText("@pro")).toHaveClass("pro-username");
    });
  });
});

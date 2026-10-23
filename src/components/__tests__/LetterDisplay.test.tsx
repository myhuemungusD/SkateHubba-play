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

  it("dims the inactive name with the text-dim token, not opacity (SF-B2)", () => {
    render(<LetterDisplay count={1} name="@them" testId="them" />);
    expect(screen.getByText("@them")).toHaveClass("text-dim");
    expect(screen.getByTestId("them").className).not.toContain("opacity-70");
  });

  it("reserves the pill and clock rows on the inactive card so the height holds (SF-B3)", () => {
    render(
      <LetterDisplay count={1} name="@them" turnLabel="THEIR MOVE" deadline={Date.now() + 60_000} testId="them" />,
    );
    expect(screen.getByTestId("turn-pill-spacer")).toHaveClass("invisible");
    expect(screen.getByTestId("turn-pill-spacer")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("timer-spacer")).toHaveClass("invisible");
  });

  it("reserves nothing when the card has no turn label or deadline", () => {
    render(<LetterDisplay count={1} name="@them" testId="them" />);
    expect(screen.queryByTestId("turn-pill-spacer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timer-spacer")).not.toBeInTheDocument();
  });

  it("lets the card shrink inside a narrow row and sizes pips to it (MF-B1)", () => {
    render(<LetterDisplay count={1} name="@them" testId="them" />);
    const card = screen.getByTestId("them");
    expect(card).toHaveClass("@container", "min-w-0", "flex-1");
    expect(screen.getByText("S")).toHaveClass("h-5", "@[8.5rem]:h-6", "@[11rem]:h-8");
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

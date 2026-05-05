import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stub the context module so the overlay reads test-controlled state.
const ctxValue = vi.hoisted(() => {
  const makeDefault = () => ({
    loading: false,
    shouldShow: true,
    currentStep: 0,
    totalSteps: 5,
    advance: vi.fn(),
    back: vi.fn(),
    skip: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    replay: vi.fn().mockResolvedValue(undefined),
    reducedMotion: false,
  });
  return { current: makeDefault(), makeDefault };
});

vi.mock("../../../context/OnboardingContext", () => ({
  useOnboardingContext: () => ctxValue.current,
}));

import { TutorialOverlay } from "../TutorialOverlay";
import { TUTORIAL_STEPS } from "../tutorialSteps";

beforeEach(() => {
  ctxValue.current = ctxValue.makeDefault();
});

describe("TutorialOverlay", () => {
  it("renders nothing while loading", () => {
    ctxValue.current.loading = true;
    const { container } = render(<TutorialOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when shouldShow is false", () => {
    ctxValue.current.shouldShow = false;
    const { container } = render(<TutorialOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the non-modal coach mark with the current step copy", () => {
    render(<TutorialOverlay />);
    const dialog = screen.getByRole("dialog");
    // Coach mark is intentionally non-modal (Pokemon Go style) so the
    // underlying app stays interactive — aria-modal MUST NOT be set.
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(dialog).toHaveAttribute("aria-labelledby", "onboarding-title");
    expect(screen.getByRole("heading", { name: TUTORIAL_STEPS[0].title })).toBeInTheDocument();
    expect(screen.getByText(TUTORIAL_STEPS[0].bubble)).toBeInTheDocument();
  });

  it("hides the back button on the first step", () => {
    render(<TutorialOverlay />);
    expect(screen.queryByRole("button", { name: /^back$/ })).toBeNull();
  });

  it("shows the back button on later steps and wires it to back()", async () => {
    ctxValue.current.currentStep = 2;
    render(<TutorialOverlay />);
    await userEvent.click(screen.getByRole("button", { name: /^back$/ }));
    expect(ctxValue.current.back).toHaveBeenCalledTimes(1);
  });

  it("primary CTA invokes advance() on non-final steps", async () => {
    render(<TutorialOverlay />);
    await userEvent.click(screen.getByRole("button", { name: TUTORIAL_STEPS[0].primaryCtaLabel }));
    expect(ctxValue.current.advance).toHaveBeenCalledTimes(1);
    expect(ctxValue.current.complete).not.toHaveBeenCalled();
  });

  it("primary CTA invokes complete() on the final step", async () => {
    const finalIdx = TUTORIAL_STEPS.findIndex((s) => s.isFinal);
    ctxValue.current.currentStep = finalIdx;
    render(<TutorialOverlay />);
    await userEvent.click(screen.getByRole("button", { name: TUTORIAL_STEPS[finalIdx].primaryCtaLabel }));
    expect(ctxValue.current.complete).toHaveBeenCalledTimes(1);
  });

  it("Escape key triggers skip()", async () => {
    render(<TutorialOverlay />);
    await userEvent.keyboard("{Escape}");
    expect(ctxValue.current.skip).toHaveBeenCalledTimes(1);
  });

  it("skip button triggers skip()", async () => {
    render(<TutorialOverlay />);
    await userEvent.click(screen.getByRole("button", { name: /^skip$/ }));
    expect(ctxValue.current.skip).toHaveBeenCalledTimes(1);
  });

  it("renders the confetti burst on the final step when reducedMotion is false", () => {
    const finalIdx = TUTORIAL_STEPS.findIndex((s) => s.isFinal);
    ctxValue.current.currentStep = finalIdx;
    render(<TutorialOverlay />);
    expect(screen.getByTestId("tutorial-confetti")).toBeInTheDocument();
  });

  it("omits the confetti burst on the final step when reducedMotion is true", () => {
    const finalIdx = TUTORIAL_STEPS.findIndex((s) => s.isFinal);
    ctxValue.current.currentStep = finalIdx;
    ctxValue.current.reducedMotion = true;
    render(<TutorialOverlay />);
    expect(screen.queryByTestId("tutorial-confetti")).toBeNull();
  });

  it("never renders confetti on non-final steps", () => {
    render(<TutorialOverlay />);
    expect(screen.queryByTestId("tutorial-confetti")).toBeNull();
  });

  it("announces step progress via the live region (Step N of total)", () => {
    ctxValue.current.currentStep = 1;
    render(<TutorialOverlay />);
    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent(/step 2 of 5/i);
  });
});

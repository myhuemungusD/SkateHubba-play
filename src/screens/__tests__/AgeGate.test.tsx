import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgeGate } from "../AgeGate";

vi.mock("../../services/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("AgeGate", () => {
  const defaultProps = {
    onVerified: vi.fn(),
    onBack: vi.fn(),
    onNav: vi.fn(),
  };

  it("renders age verification form", () => {
    render(<AgeGate {...defaultProps} />);
    expect(screen.getByRole("heading", { name: "Verify Your Age" })).toBeInTheDocument();
    expect(screen.getByLabelText("Birth month")).toBeInTheDocument();
    expect(screen.getByLabelText("Birth day")).toBeInTheDocument();
    expect(screen.getByLabelText("Birth year")).toBeInTheDocument();
  });

  it("shows error for incomplete date", async () => {
    render(<AgeGate {...defaultProps} />);
    await userEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("Please enter your full date of birth")).toBeInTheDocument();
  });

  it("blocks users under 13 with COPPA message", async () => {
    render(<AgeGate {...defaultProps} />);
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2020");
    await userEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("Sorry!")).toBeInTheDocument();
    expect(screen.getByText(/at least 13 years old/)).toBeInTheDocument();
  });

  it("calls onVerified for valid adult date", async () => {
    const onVerified = vi.fn();
    render(<AgeGate {...defaultProps} onVerified={onVerified} />);
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "15");
    await userEvent.type(screen.getByLabelText("Birth year"), "2000");
    await userEvent.click(screen.getByText("Continue"));
    expect(onVerified).toHaveBeenCalledWith("2000-01-15", false);
  });

  it("shows parental consent checkbox for minors (13-17)", async () => {
    render(<AgeGate {...defaultProps} />);
    // Enter age that makes user 15 (born 2011 for test in 2026)
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2011");
    expect(screen.getByText(/parent or legal guardian/)).toBeInTheDocument();
  });

  it("requires parental consent for minors before proceeding", async () => {
    render(<AgeGate {...defaultProps} />);
    await userEvent.type(screen.getByLabelText("Birth month"), "01");
    await userEvent.type(screen.getByLabelText("Birth day"), "01");
    await userEvent.type(screen.getByLabelText("Birth year"), "2011");
    await userEvent.click(screen.getByText("Continue"));
    expect(screen.getByText(/Parental or guardian consent is required/)).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<AgeGate {...defaultProps} onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows error for invalid date like Feb 30", async () => {
    render(<AgeGate {...defaultProps} />);
    await userEvent.type(screen.getByLabelText("Birth month"), "02");
    await userEvent.type(screen.getByLabelText("Birth day"), "30");
    await userEvent.type(screen.getByLabelText("Birth year"), "2000");
    await userEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("Please enter a valid date")).toBeInTheDocument();
  });
});

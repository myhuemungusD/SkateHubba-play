import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TermsOfService } from "../TermsOfService";

describe("TermsOfService", () => {
  it("renders heading and brand name", () => {
    render(<TermsOfService onBack={vi.fn()} />);
    expect(screen.getByText("Terms of Service")).toBeInTheDocument();
    expect(screen.getByText("SKATEHUBBA™")).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<TermsOfService onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

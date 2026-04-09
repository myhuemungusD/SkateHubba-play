import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrivacyPolicy } from "../PrivacyPolicy";

describe("PrivacyPolicy", () => {
  it("renders heading and brand logo", () => {
    render(<PrivacyPolicy onBack={vi.fn()} />);
    expect(screen.getByText("Privacy Policy")).toBeInTheDocument();
    expect(document.querySelector('img[src="/logonew.webp"]')).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<PrivacyPolicy onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows Data Deletion link when onNav is provided", () => {
    render(<PrivacyPolicy onBack={vi.fn()} onNav={vi.fn()} />);
    expect(screen.getByText("Data Deletion page")).toBeInTheDocument();
  });
});

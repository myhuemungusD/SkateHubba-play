import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TermsOfService } from "../TermsOfService";

describe("TermsOfService", () => {
  it("renders heading and brand logo", () => {
    render(<TermsOfService onBack={vi.fn()} />);
    expect(screen.getByText("Terms of Service")).toBeInTheDocument();
    expect(document.querySelector('img[src="/logonew.webp"]')).toBeInTheDocument();
  });

  it("licenses content for the feed and referees, and gives Hubba Bucks no cash value", () => {
    render(<TermsOfService onBack={vi.fn()} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("in the community feed");
    expect(text).toContain("community vote");
    expect(text).toContain("no cash value");
    expect(text).not.toContain("lawyer");
    expect(text).not.toContain("share it publicly outside of your game");
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<TermsOfService onBack={onBack} />);
    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});

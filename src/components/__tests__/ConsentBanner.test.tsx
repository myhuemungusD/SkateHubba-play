import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentBanner } from "../ConsentBanner";

beforeEach(() => {
  localStorage.clear();
});

describe("ConsentBanner", () => {
  it("renders when no consent stored", () => {
    render(<ConsentBanner onNav={vi.fn()} />);
    expect(screen.getByRole("region", { name: /analytics notice/i })).toBeInTheDocument();
  });

  it("hides when consent is already stored", () => {
    localStorage.setItem("sh_analytics_consent", "accepted");
    const { container } = render(<ConsentBanner onNav={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("stores consent and hides on OK click", async () => {
    render(<ConsentBanner onNav={vi.fn()} />);
    await userEvent.click(screen.getByText("OK"));
    expect(localStorage.getItem("sh_analytics_consent")).toBe("accepted");
  });

  it("stores decline and hides on Decline click", async () => {
    render(<ConsentBanner onNav={vi.fn()} />);
    await userEvent.click(screen.getByText("No"));
    expect(localStorage.getItem("sh_analytics_consent")).toBe("declined");
  });

  it("navigates to privacy policy when link is clicked", async () => {
    const onNav = vi.fn();
    render(<ConsentBanner onNav={onNav} />);
    await userEvent.click(screen.getByText("Privacy Policy"));
    expect(onNav).toHaveBeenCalledWith("privacy");
  });
});

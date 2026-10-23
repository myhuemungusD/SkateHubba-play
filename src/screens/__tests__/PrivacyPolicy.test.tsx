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

  it("navigates to the Data Deletion page", async () => {
    const onNav = vi.fn();
    render(<PrivacyPolicy onBack={vi.fn()} onNav={onNav} />);
    await userEvent.click(screen.getByText("Data Deletion page"));
    expect(onNav).toHaveBeenCalledWith("datadeletion");
  });

  it("every back control returns", async () => {
    const onBack = vi.fn();
    render(<PrivacyPolicy onBack={onBack} />);
    const backs = screen.getAllByRole("button", { name: /back/i });
    for (const b of backs) await userEvent.click(b);
    expect(onBack).toHaveBeenCalledTimes(backs.length);
  });

  // Compliance audit A10: every data type and processor the app uses is disclosed.
  it("discloses Apple sign-in, the 2FA phone number, chat, comments and profile content", () => {
    render(<PrivacyPolicy onBack={vi.fn()} />);
    const text = document.body.textContent ?? "";
    for (const phrase of [
      "Google or Apple",
      "two-step",
      "spot's chat",
      "comments you leave on clips",
      "profile photo and banner image",
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it("lists Mapbox and Video Intelligence as processors and has no stale promises", () => {
    render(<PrivacyPolicy onBack={vi.fn()} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Mapbox");
    expect(text).toContain("Google Cloud Video Intelligence");
    expect(text).not.toContain("ships with the account-deletion update");
    expect(text).not.toContain("profile photo URL");
    expect(text).toContain("Trick recognition training");
  });

  // Review of #825: every claim matches what the app does today.
  it("covers all three platforms, every processor, and pseudonymous IDs", () => {
    render(<PrivacyPolicy onBack={vi.fn()} />);
    const text = document.body.textContent ?? "";
    for (const phrase of [
      "iPhone and Android apps",
      "Speed Insights",
      "reCAPTCHA",
      "Play Integrity",
      "Apple Push Notification service",
      "pseudonymous ID",
      "Download my data",
      "even without signing in",
      "posted to the community feed automatically",
      "Kept with your name removed",
      "daily database backups expire within 7 days",
      "90 days after",
    ]) {
      expect(text).toContain(phrase);
    }
    for (const stale of ["hashed before transmission", "is not stored", "lawyer", "no personal information is"]) {
      expect(text).not.toContain(stale);
    }
  });
});

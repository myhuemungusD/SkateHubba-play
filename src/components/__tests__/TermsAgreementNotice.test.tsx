import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TermsAgreementNotice } from "../legal/TermsAgreementNotice";

describe("TermsAgreementNotice", () => {
  it("states the agreement and the zero-tolerance policy with both links", () => {
    render(<TermsAgreementNotice />);
    const notice = screen.getByTestId("terms-agreement-notice");
    expect(notice).toHaveTextContent(
      "By continuing you agree to our Terms and Privacy Policy. Zero tolerance for objectionable content or abusive users.",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });

  it("routes in-app and cancels the page load when a handler is given", () => {
    const onNav = vi.fn();
    render(<TermsAgreementNotice onNav={onNav} />);
    const termsClick = fireEvent.click(screen.getByRole("link", { name: "Terms" }));
    const privacyClick = fireEvent.click(screen.getByRole("link", { name: "Privacy Policy" }));
    // fireEvent.click returns false when the default action was prevented.
    expect(termsClick).toBe(false);
    expect(privacyClick).toBe(false);
    expect(onNav).toHaveBeenNthCalledWith(1, "terms");
    expect(onNav).toHaveBeenNthCalledWith(2, "privacy");
  });

  it("falls back to the plain link when there is no handler", () => {
    render(<TermsAgreementNotice className="mt-2" />);
    const link = screen.getByRole("link", { name: "Terms" });
    // jsdom doesn't navigate, but the default must NOT be prevented.
    expect(fireEvent.click(link)).toBe(true);
    expect(screen.getByTestId("terms-agreement-notice")).toHaveClass("mt-2");
  });
});

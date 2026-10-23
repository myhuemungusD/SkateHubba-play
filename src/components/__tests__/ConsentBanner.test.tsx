import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ConsentBanner,
  CONSENT_BANNER_INSET_VAR,
  CONSENT_BANNER_OPEN_CLASS,
  CONSENT_BANNER_SPACE_VAR,
} from "../ConsentBanner";
import { subscribeConsent } from "../../lib/consent";

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

  it("notifies consent subscribers when the user accepts", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);
    render(<ConsentBanner onNav={vi.fn()} />);
    await userEvent.click(screen.getByText("OK"));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("gives the privacy control a 44px target and stays on the bottom edge", () => {
    render(<ConsentBanner onNav={vi.fn()} />);
    const privacy = screen.getByText("Privacy Policy");
    expect(privacy.className).toContain("min-h-11");
    expect(screen.getByRole("region", { name: /analytics notice/i }).className).toContain("bottom-0");
  });

  it("sits above the tab bar when the nav is on screen", () => {
    render(<ConsentBanner onNav={vi.fn()} liftAboveNav />);
    const region = screen.getByRole("region", { name: /analytics notice/i });
    expect(region.className).toContain("bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))]");
    expect(region.className).not.toContain("bottom-0");
  });

  it("notifies consent subscribers when the user declines", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);
    render(<ConsentBanner onNav={vi.fn()} />);
    await userEvent.click(screen.getByText("No"));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("ConsentBanner bottom clearance", () => {
  const root = () => document.documentElement;

  it("reserves bottom space on <html> while visible and releases it on OK", async () => {
    render(<ConsentBanner onNav={vi.fn()} />);
    expect(root().classList.contains(CONSENT_BANNER_OPEN_CLASS)).toBe(true);
    expect(root().style.getPropertyValue(CONSENT_BANNER_SPACE_VAR)).toMatch(/^\d+px$/);

    await userEvent.click(screen.getByText("OK"));
    expect(root().classList.contains(CONSENT_BANNER_OPEN_CLASS)).toBe(false);
    expect(root().style.getPropertyValue(CONSENT_BANNER_SPACE_VAR)).toBe("");
    // Consent semantics unchanged: analytics only after an explicit OK.
    expect(localStorage.getItem("sh_analytics_consent")).toBe("accepted");
  });

  it("releases the reserved space when declined", async () => {
    render(<ConsentBanner onNav={vi.fn()} />);
    await userEvent.click(screen.getByText("No"));
    expect(root().classList.contains(CONSENT_BANNER_OPEN_CLASS)).toBe(false);
  });

  it("never reserves space when consent was already given", () => {
    localStorage.setItem("sh_analytics_consent", "declined");
    render(<ConsentBanner onNav={vi.fn()} />);
    expect(root().classList.contains(CONSENT_BANNER_OPEN_CLASS)).toBe(false);
  });

  it("re-measures via ResizeObserver and disconnects on unmount", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let onResize: (() => void) | undefined;
    const realRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = vi.fn(function (this: unknown, cb: () => void) {
      onResize = cb;
      return { observe, disconnect, unobserve: vi.fn() };
    }) as unknown as typeof ResizeObserver;
    try {
      const { unmount } = render(<ConsentBanner onNav={vi.fn()} />);
      expect(observe).toHaveBeenCalledWith(screen.getByRole("region", { name: /analytics notice/i }));
      onResize?.();
      expect(root().style.getPropertyValue(CONSENT_BANNER_SPACE_VAR)).toMatch(/^\d+px$/);
      unmount();
      expect(disconnect).toHaveBeenCalled();
      expect(root().classList.contains(CONSENT_BANNER_OPEN_CLASS)).toBe(false);
    } finally {
      globalThis.ResizeObserver = realRO;
    }
  });

  /**
   * Regression: the tour bubble (bottom dock, mb-20) and the lifted banner
   * (bottom 5.5rem) were both pinned to the bottom edge with no shared
   * number, so the banner's OK/No row sat on the tour's NEXT button. The
   * banner now publishes its top edge as an inset the bubble docks above.
   */
  it("publishes its top edge as an inset from the viewport bottom, and re-measures when lifted", () => {
    const rect = (top: number) =>
      ({
        top,
        bottom: top + 60,
        height: 60,
        left: 0,
        right: 390,
        width: 390,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect(window.innerHeight - 60));
    try {
      const { rerender, unmount } = render(<ConsentBanner onNav={vi.fn()} />);
      expect(root().style.getPropertyValue(CONSENT_BANNER_INSET_VAR)).toBe("60px");
      spy.mockReturnValue(rect(window.innerHeight - 60 - 122));
      rerender(<ConsentBanner onNav={vi.fn()} liftAboveNav />);
      expect(root().style.getPropertyValue(CONSENT_BANNER_INSET_VAR)).toBe("182px");
      spy.mockReturnValue(rect(window.innerHeight - 70));
      window.dispatchEvent(new Event("resize"));
      expect(root().style.getPropertyValue(CONSENT_BANNER_INSET_VAR)).toBe("70px");
      unmount();
      expect(root().style.getPropertyValue(CONSENT_BANNER_INSET_VAR)).toBe("");
    } finally {
      spy.mockRestore();
    }
  });
});

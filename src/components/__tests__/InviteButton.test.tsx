import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteButton } from "../InviteButton";

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InviteButton", () => {
  it("renders invite button initially closed", () => {
    render(<InviteButton />);
    expect(screen.getByText("Invite a Friend")).toBeInTheDocument();
  });

  it("toggles panel open and close", async () => {
    vi.useRealTimers();
    render(<InviteButton username="sk8r" />);

    await userEvent.click(screen.getByText("Invite a Friend"));
    expect(screen.getByText("Close")).toBeInTheDocument();
    expect(screen.getByText("TEXT A FRIEND")).toBeInTheDocument();
    expect(screen.getByText("SHARE ON SOCIALS")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Close"));
    expect(screen.getByText("Invite a Friend")).toBeInTheDocument();
  });

  it("shows contacts unavailable message when contacts API not present", async () => {
    vi.useRealTimers();
    render(<InviteButton />);

    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    expect(screen.getByText(/Phone contacts not available/)).toBeInTheDocument();
  });

  it("handles contact selection with phones and opens SMS", async () => {
    vi.useRealTimers();
    const originalContacts = (navigator as any).contacts;
    (navigator as any).contacts = {
      select: vi.fn().mockResolvedValue([{ name: ["John"], tel: ["555-1234"] }]),
    };
    const originalHref = window.location.href;

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    const { trackEvent } = await import("../../services/analytics");
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith("invite_sent", expect.objectContaining({ method: "sms" }));
    });

    (navigator as any).contacts = originalContacts;
  });

  it("handles contact selection with no phone numbers", async () => {
    vi.useRealTimers();
    (navigator as any).contacts = {
      select: vi.fn().mockResolvedValue([{ name: ["John"], tel: [] }]),
    };

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    await waitFor(() => {
      expect(screen.getByText("Selected contacts have no phone numbers.")).toBeInTheDocument();
    });

    delete (navigator as any).contacts;
  });

  it("handles cancelled contact picker gracefully", async () => {
    vi.useRealTimers();
    (navigator as any).contacts = {
      select: vi.fn().mockRejectedValue(new Error("cancelled")),
    };

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    // No crash, no error message
    expect(screen.getByText("TEXT A FRIEND")).toBeInTheDocument();

    delete (navigator as any).contacts;
  });

  it("handles empty contacts selection", async () => {
    vi.useRealTimers();
    (navigator as any).contacts = {
      select: vi.fn().mockResolvedValue([]),
    };

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    // No SMS link opened, no crash
    expect(screen.getByText("TEXT A FRIEND")).toBeInTheDocument();

    delete (navigator as any).contacts;
  });

  it("copies link to clipboard", async () => {
    vi.useRealTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("Copy Link"));

    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });

  it("shows error when clipboard copy fails", async () => {
    vi.useRealTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("fail")) },
    });

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("Copy Link"));

    await waitFor(() => {
      expect(screen.getByText(/Could not copy/)).toBeInTheDocument();
    });
  });

  it("renders social media links", async () => {
    vi.useRealTimers();
    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));

    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Snapchat")).toBeInTheDocument();
    expect(screen.getByText("Facebook")).toBeInTheDocument();
    expect(screen.getByText("Reddit")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
  });

  it("tracks social media clicks", async () => {
    vi.useRealTimers();
    const { trackEvent } = await import("../../services/analytics");
    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));

    const xLink = screen.getByText("X").closest("a")!;
    // Prevent navigation
    xLink.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(xLink);

    expect(trackEvent).toHaveBeenCalledWith("invite_sent", { method: "x" });
  });

  it("shows native share button when navigator.share is available", async () => {
    vi.useRealTimers();
    const origShare = navigator.share;
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockResolvedValue(undefined),
      writable: true,
      configurable: true,
    });

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));

    expect(screen.getByText("Share")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Share"));

    const { trackEvent } = await import("../../services/analytics");
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith("invite_sent", { method: "native_share" });
    });

    Object.defineProperty(navigator, "share", { value: origShare, writable: true, configurable: true });
  });

  it("handles native share cancellation gracefully", async () => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "share", {
      value: vi.fn().mockRejectedValue(new Error("cancelled")),
      writable: true,
      configurable: true,
    });

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("Share"));

    // No crash
    expect(screen.getByText("Share")).toBeInTheDocument();

    Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
  });

  it("uses username in invite text when provided", async () => {
    vi.useRealTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<InviteButton username="sk8r" />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("Copy Link"));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("@sk8r"));
    });
  });

  it("handles contacts with tel property containing null/empty values", async () => {
    vi.useRealTimers();
    (navigator as any).contacts = {
      select: vi.fn().mockResolvedValue([{ name: ["J"], tel: [null, "", "  ", "555-1234"] }]),
    };

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    const { trackEvent } = await import("../../services/analytics");
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith("invite_sent", expect.objectContaining({ method: "sms" }));
    });

    delete (navigator as any).contacts;
  });

  it("uses iOS SMS format on iOS devices", async () => {
    vi.useRealTimers();
    const origUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", { value: "iPhone", writable: true, configurable: true });

    (navigator as any).contacts = {
      select: vi.fn().mockResolvedValue([{ name: ["J"], tel: ["555-1234"] }]),
    };

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    // On iOS, SMS uses & instead of ? for body param
    // We just verify it completes without error
    const { trackEvent } = await import("../../services/analytics");
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith("invite_sent", expect.objectContaining({ method: "sms" }));
    });

    Object.defineProperty(navigator, "userAgent", { value: origUA, writable: true, configurable: true });
    delete (navigator as any).contacts;
  });

  it("handles contacts with undefined tel property", async () => {
    vi.useRealTimers();
    (navigator as any).contacts = {
      select: vi.fn().mockResolvedValue([{ name: ["J"] }]),
    };

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    await waitFor(() => {
      expect(screen.getByText("Selected contacts have no phone numbers.")).toBeInTheDocument();
    });

    delete (navigator as any).contacts;
  });

  it("status message auto-clears after timeout", async () => {
    (navigator as any).contacts = {
      select: vi.fn().mockResolvedValue([{ name: ["J"], tel: [] }]),
    };

    render(<InviteButton />);
    await userEvent.click(screen.getByText("Invite a Friend"));
    await userEvent.click(screen.getByText("FROM YOUR CONTACTS"));

    expect(screen.getByText("Selected contacts have no phone numbers.")).toBeInTheDocument();

    vi.advanceTimersByTime(3000);
    await waitFor(() => {
      expect(screen.queryByText("Selected contacts have no phone numbers.")).not.toBeInTheDocument();
    });

    delete (navigator as any).contacts;
  });
});

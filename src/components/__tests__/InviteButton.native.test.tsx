import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteButton } from "../InviteButton";
import { trackEvent } from "../../services/analytics";
import { copyText, shareUrl } from "../../services/nativeBridge";

vi.mock("../../services/analytics", () => ({ trackEvent: vi.fn() }));

// Native shell: the bridge reports a share sheet even though the Android
// WebView has no navigator.share, and both actions go through the plugins.
vi.mock("../../services/nativeBridge", () => ({
  isShareAvailable: () => true,
  shareUrl: vi.fn().mockResolvedValue("native_share_text"),
  copyText: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
});

async function openPanel(): Promise<void> {
  render(<InviteButton username="sk8r" />);
  await userEvent.click(screen.getByText("Invite a Friend"));
}

describe("InviteButton on native", () => {
  it("offers the share sheet without navigator.share and routes to the bridge", async () => {
    await openPanel();
    await userEvent.click(screen.getByText("Share"));

    await waitFor(() => {
      expect(shareUrl).toHaveBeenCalledWith(
        expect.objectContaining({ title: "SkateHubba", text: expect.stringContaining("@sk8r") }),
      );
    });
    expect(trackEvent).toHaveBeenCalledWith("invite_sent", { method: "native_share" });
  });

  it("copies through the bridge instead of navigator.clipboard", async () => {
    await openPanel();
    await userEvent.click(screen.getByText("Copy Link"));

    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("@sk8r"));
  });
});

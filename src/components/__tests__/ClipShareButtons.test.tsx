import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipShareButtons } from "../waiting/ClipShareButtons";
import { trackEvent } from "../../services/analytics";
import { shareText } from "../../services/nativeBridge";

vi.mock("../../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../services/nativeBridge", () => ({ shareText: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["v"], { type: "video/webm" })) }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ClipShareButtons", () => {
  it("reports the method the bridge used and resets the label after 2s", async () => {
    vi.mocked(shareText).mockResolvedValue("clipboard");
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" />);

    await userEvent.click(screen.getByText("Share Clip"));

    expect(await screen.findByText("Shared!")).toBeInTheDocument();
    expect(shareText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Check out my Kick Flip on SkateHubba!",
        textWithoutFiles: expect.stringContaining("Check out my Kick Flip on SkateHubba!\n"),
      }),
    );
    expect(trackEvent).toHaveBeenCalledWith("clip_shared", { method: "clipboard", context: "waiting_screen" });

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });

  it("shows a failure label when the bridge rejects", async () => {
    vi.mocked(shareText).mockRejectedValue(new Error("cancelled"));
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" />);

    await userEvent.click(screen.getByText("Share Clip"));

    expect(await screen.findByText("Share failed")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });
});

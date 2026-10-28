import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipShareButtons } from "../waiting/ClipShareButtons";
import { trackEvent } from "../../services/analytics";
import { shareText } from "../../services/nativeBridge";
import { captureException } from "../../lib/sentry";

vi.mock("../../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../services/nativeBridge", () => ({ shareText: vi.fn() }));
vi.mock("../../lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sentry")>()),
  captureException: vi.fn(),
}));

// Real download URLs carry a Storage access token.
const TOKEN_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.webm?alt=media&token=secret-token";

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
  vi.restoreAllMocks();
});

describe("ClipShareButtons", () => {
  it("reports the method the bridge used, links the text to the owner's profile, and resets after 2s", async () => {
    vi.mocked(shareText).mockResolvedValue("clipboard");
    render(<ClipShareButtons videoUrl="https://cdn/clip.webm" trickName="Kick Flip" ownerUid="uid-me" />);

    await userEvent.click(screen.getByText("Share Clip"));

    expect(await screen.findByText("Shared!")).toBeInTheDocument();
    expect(shareText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Check out my Kick Flip on SkateHubba!",
        // No file share: the text links to the clip owner's public profile.
        textWithoutFiles: expect.stringMatching(
          /^Check out my Kick Flip on SkateHubba!\nhttps?:\/\/.+\/player\/uid-me$/,
        ),
      }),
    );
    expect(trackEvent).toHaveBeenCalledWith("clip_shared", { method: "clipboard", context: "waiting_screen" });

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });

  it("shares the clip as a flat-named file typed from the download", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["v"], { type: "video/mp4" })),
    } as unknown as Response);
    vi.mocked(shareText).mockResolvedValue("native_share");
    render(<ClipShareButtons videoUrl="https://cdn/clip.mp4" trickName="50/50 Grind" ownerUid="uid-me" />);

    await userEvent.click(screen.getByText("Share Clip"));
    await screen.findByText("Shared!");

    const files = await vi.mocked(shareText).mock.calls[0][0].loadFiles!();
    expect(files[0].name).toBe("skatehubba-50-50-grind.mp4");
    expect(files[0].type).toBe("video/mp4");
  });

  it("shows a failure label and reports without the download URL when the bridge rejects", async () => {
    vi.mocked(shareText).mockRejectedValue(new Error("No activity found"));
    render(<ClipShareButtons videoUrl={TOKEN_URL} trickName="Kick Flip" ownerUid="uid-me" />);

    await userEvent.click(screen.getByText("Share Clip"));

    expect(await screen.findByText("Share failed")).toBeInTheDocument();
    // The token-bearing download URL never reaches Sentry.
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "ClipShareButtons.share", trickName: "Kick Flip" },
    });
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toMatch(/secret-token|firebasestorage/);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Share Clip")).toBeInTheDocument();
  });

  it("saves the clip under a flat name with the downloaded file's real type", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["v"], { type: "video/mp4" })),
    } as unknown as Response);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    render(<ClipShareButtons videoUrl={TOKEN_URL} trickName="Flîp 50/50" ownerUid="uid-me" />);

    await userEvent.click(screen.getByText("Save Clip"));

    expect(await screen.findByText("Saved!")).toBeInTheDocument();
    expect(names).toEqual(["skatehubba-flip-50-50.mp4"]);
    expect(trackEvent).toHaveBeenCalledWith("clip_saved", { context: "waiting_screen" });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    expect(screen.getByText("Save Clip")).toBeInTheDocument();
  });

  it("shows a failure label and reports without the download URL when the download fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as unknown as Response);
    render(<ClipShareButtons videoUrl={TOKEN_URL} trickName="Kick Flip" ownerUid="uid-me" />);

    await userEvent.click(screen.getByText("Save Clip"));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "ClipShareButtons.save", trickName: "Kick Flip" },
    });
    expect(JSON.stringify(vi.mocked(captureException).mock.calls)).not.toMatch(/secret-token|firebasestorage/);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Save Clip")).toBeInTheDocument();
  });
});

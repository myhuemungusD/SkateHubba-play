import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TurnHistoryViewer } from "../TurnHistoryViewer";
import type { TurnRecord } from "../../services/games";

vi.mock("../../utils/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/helpers")>();
  return {
    ...actual,
    isFirebaseStorageUrl: (url: string) => url.startsWith("https://firebasestorage.googleapis.com"),
  };
});

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
}));

const makeTurn = (n: number, overrides?: Partial<TurnRecord>): TurnRecord => ({
  turnNumber: n,
  trickName: `Kickflip ${n}`,
  setterUid: "u1",
  setterUsername: "alice",
  matcherUid: "u2",
  matcherUsername: "bob",
  setVideoUrl: `https://firebasestorage.googleapis.com/set${n}.webm`,
  matchVideoUrl: `https://firebasestorage.googleapis.com/match${n}.webm`,
  landed: true,
  letterTo: null,
  ...overrides,
});

describe("TurnHistoryViewer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when turns is empty", () => {
    const { container } = render(<TurnHistoryViewer turns={[]} currentUserUid="u1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders collapsed by default with correct count", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1), makeTurn(2)]} currentUserUid="u1" />);
    expect(screen.getByText("Game Clips (2 rounds)")).toBeInTheDocument();
    // Turns should not be visible
    expect(screen.queryByText("Kickflip 1")).not.toBeInTheDocument();
  });

  it("uses singular 'round' for 1 turn", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);
    expect(screen.getByText("Game Clips (1 round)")).toBeInTheDocument();
  });

  it("expands on button click to show turns", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    await userEvent.click(screen.getByText("Game Clips (1 round)"));
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();
    expect(screen.getByText("Landed")).toBeInTheDocument();
    expect(screen.getByText(/@alice's trick/)).toBeInTheDocument();
    expect(screen.getByText(/@bob's attempt/)).toBeInTheDocument();
  });

  it("renders expanded by default when defaultExpanded is true", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded />);
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();
  });

  it("shows Missed badge and letter info", () => {
    render(
      <TurnHistoryViewer
        turns={[makeTurn(1, { landed: false, letterTo: "u2" })]}
        currentUserUid="u1"
        defaultExpanded
      />,
    );
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getByText(/@bob gets a letter/)).toBeInTheDocument();
  });

  it("shows (you) when letter is to current user", () => {
    render(
      <TurnHistoryViewer
        turns={[makeTurn(1, { landed: false, letterTo: "u1", matcherUid: "u1", matcherUsername: "me" })]}
        currentUserUid="u1"
        defaultExpanded
      />,
    );
    expect(screen.getByText(/(you)/)).toBeInTheDocument();
  });

  it("collapses on second toggle click", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    const toggle = screen.getByRole("button", { name: /Game Clips/ });
    await userEvent.click(toggle);
    expect(screen.getByText("Round 1: Kickflip 1")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText("Round 1: Kickflip 1")).not.toBeInTheDocument();
  });

  it("has aria-expanded attribute on toggle button", async () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" />);

    const toggle = screen.getByRole("button", { name: /Game Clips/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders video elements with aria labels when expanded", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded />);
    expect(screen.getByLabelText("Kickflip 1 set by alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Kickflip 1 attempted by bob")).toBeInTheDocument();
  });

  it("skips ClipVideo for non-firebase URLs", () => {
    const turn = makeTurn(1, { setVideoUrl: "https://example.com/v.webm", matchVideoUrl: "" });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    // Non-firebase URLs return null from ClipVideo
    expect(screen.queryByLabelText(/Kickflip 1 set by/)).not.toBeInTheDocument();
  });

  it("shows download buttons when showDownload is true", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    const saveButtons = screen.getAllByText("Save clip");
    expect(saveButtons.length).toBe(2); // one for set, one for match
  });

  it("shows share buttons when showShare is true", () => {
    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showShare />);
    const shareButtons = screen.getAllByText("Share clip");
    expect(shareButtons.length).toBe(2);
  });

  it("download button transitions through saving states", async () => {
    const mockBlob = new Blob(["video"], { type: "video/webm" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: () => Promise.resolve(mockBlob) } as Response);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);

    await waitFor(() => {
      expect(screen.getByText("Saved!")).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it("download anchor uses .webm extension for video/webm blobs (web clips)", async () => {
    const blob = new Blob(["video"], { type: "video/webm" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) } as Response);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const downloadAttr = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadAttr(this.download);
    });

    render(<TurnHistoryViewer turns={[makeTurn(7)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);

    await waitFor(() => expect(downloadAttr).toHaveBeenCalledWith("skatehubba-round7-set.webm"));
    clickSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("download anchor uses .mp4 extension for video/mp4 blobs (native clips)", async () => {
    const blob = new Blob(["video"], { type: "video/mp4" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) } as Response);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const downloadAttr = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadAttr(this.download);
    });

    render(<TurnHistoryViewer turns={[makeTurn(9)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);

    await waitFor(() => expect(downloadAttr).toHaveBeenCalledWith("skatehubba-round9-set.mp4"));
    clickSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("share file uses video/mp4 type and .mp4 name for native clips", async () => {
    const blob = new Blob(["video"], { type: "video/mp4" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) } as Response);
    const shareFn = vi.fn().mockResolvedValue(undefined);
    const canShareFn = vi.fn().mockReturnValue(true);
    const origShare = navigator.share;
    const origCanShare = (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare;
    Object.defineProperty(navigator, "share", { value: shareFn, configurable: true, writable: true });
    Object.defineProperty(navigator, "canShare", { value: canShareFn, configurable: true, writable: true });

    render(<TurnHistoryViewer turns={[makeTurn(3)]} currentUserUid="u1" defaultExpanded showShare />);
    await userEvent.click(screen.getAllByText("Share clip")[0]);

    await waitFor(() => expect(shareFn).toHaveBeenCalled());
    const shared = shareFn.mock.calls[0][0] as { files: File[] };
    expect(shared.files[0].name).toBe("skatehubba-kickflip-3.mp4");
    expect(shared.files[0].type).toBe("video/mp4");

    Object.defineProperty(navigator, "share", { value: origShare, configurable: true, writable: true });
    Object.defineProperty(navigator, "canShare", { value: origCanShare, configurable: true, writable: true });
    vi.restoreAllMocks();
  });

  it("download button shows failure on fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showDownload />);
    await userEvent.click(screen.getAllByText("Save clip")[0]);

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it("share button uses clipboard when navigator.share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const origShare = navigator.share;
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["vid"])),
    } as Response);

    render(<TurnHistoryViewer turns={[makeTurn(1)]} currentUserUid="u1" defaultExpanded showShare />);
    await userEvent.click(screen.getAllByText("Share clip")[0]);

    await waitFor(() => {
      expect(screen.getByText("Shared!")).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalled();

    Object.defineProperty(navigator, "share", { value: origShare, configurable: true, writable: true });
    vi.restoreAllMocks();
  });

  it("shows letter recipient as setter when letterTo is setterUid (not matcherUid)", () => {
    // letterTo !== matcherUid means the setter gets the letter
    const turn = makeTurn(1, {
      landed: false,
      letterTo: "u1",
      setterUid: "u1",
      setterUsername: "alice",
      matcherUid: "u2",
      matcherUsername: "bob",
    });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u2" defaultExpanded />);
    // Since letterTo ("u1") !== matcherUid ("u2"), it shows setter's name
    expect(screen.getByText(/@alice gets a letter/)).toBeInTheDocument();
  });

  // ── Referee indicator tests ──

  it("shows 'Refereed' indicator when turn has judgedBy set", () => {
    const turn = makeTurn(1, { judgedBy: "judge-uid" });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    expect(screen.getByText("Refereed")).toBeInTheDocument();
  });

  it("hides 'Refereed' indicator when turn has no judgedBy", () => {
    const turn = makeTurn(1, { judgedBy: null });
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    expect(screen.queryByText("Refereed")).not.toBeInTheDocument();
  });

  it("hides 'Refereed' indicator when judgedBy is undefined (honor system)", () => {
    const turn = makeTurn(1);
    // Default makeTurn doesn't set judgedBy (undefined)
    render(<TurnHistoryViewer turns={[turn]} currentUserUid="u1" defaultExpanded />);
    expect(screen.queryByText("Refereed")).not.toBeInTheDocument();
  });
});

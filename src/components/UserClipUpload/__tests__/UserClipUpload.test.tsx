import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserClipUploadModal } from "..";
import { _resetUserClipCooldown } from "../useUserClipUpload";

const { mockUploadUserClip, mockCreateUserClip, mockIsNative, mockTrackEvent, mockProbe } = vi.hoisted(() => ({
  mockUploadUserClip: vi.fn(),
  mockCreateUserClip: vi.fn(),
  mockIsNative: vi.fn(() => false),
  mockTrackEvent: vi.fn(),
  mockProbe: vi.fn(),
}));

vi.mock("../../../services/storage", () => ({
  uploadUserClip: (...args: unknown[]) => mockUploadUserClip(...args),
}));

// The typed refusals come from the real module — the hook branches on
// `instanceof`, so they must be the same classes the service throws.
vi.mock("../../../services/clips.userWrites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/clips.userWrites")>();
  return {
    ClipCooldownError: actual.ClipCooldownError,
    UserBannedError: actual.UserBannedError,
    createUserClip: (...args: unknown[]) => mockCreateUserClip(...args),
    newUserClipId: () => "clip123",
  };
});

vi.mock("../../../services/nativeVideo", () => ({
  isNativePlatform: () => mockIsNative(),
  recordNativeVideo: vi.fn(),
}));

vi.mock("../../../services/analytics", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

vi.mock("../../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// The duration probe needs a real decoder; JSDOM has none. The pure
// validators own that logic and are tested directly in validation.test.ts.
vi.mock("../validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../validation")>();
  return { ...actual, probeVideoDuration: (...args: unknown[]) => mockProbe(...args) };
});

// The recorder drags in getUserMedia + MediaRecorder. Its own suite owns
// that; here it only needs to be able to hand back a finished take.
vi.mock("../../VideoRecorder", () => ({
  VideoRecorder: ({
    onRecorded,
    maxDurationSeconds,
  }: {
    onRecorded: (b: Blob | null) => void;
    maxDurationSeconds?: number;
  }) => (
    <div data-testid="recorder" data-max={maxDurationSeconds}>
      <button onClick={() => onRecorded(new Blob(["v"], { type: "video/webm" }))}>__take__</button>
      <button onClick={() => onRecorded(null)}>__empty_take__</button>
    </div>
  ),
}));

function renderModal(onPosted = vi.fn(), onClose = vi.fn()) {
  render(<UserClipUploadModal uid="me" username="viewer" onClose={onClose} onPosted={onPosted} />);
  return { onPosted, onClose };
}

/** A file that passes every shape check, so tests exercise one rule at a time. */
function goodFile(): File {
  const file = new File(["x".repeat(5000)], "clip.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: 5_000_000 });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Module-scoped by design (it must survive the modal unmounting on a
  // successful post), so it has to be cleared between cases.
  _resetUserClipCooldown();
  mockIsNative.mockReturnValue(false);
  mockProbe.mockResolvedValue(12);
  mockUploadUserClip.mockResolvedValue("https://cdn/clip123.mp4");
  mockCreateUserClip.mockResolvedValue("clip123");
});

describe("UserClipUploadModal", () => {
  it("offers both a recorder and a file picker on the web", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /film it/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload a file/i })).toBeInTheDocument();
  });

  it("hides the file picker on native, where the recorder is the only sane path", () => {
    mockIsNative.mockReturnValue(true);
    renderModal();
    expect(screen.getByRole("button", { name: /film it/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload a file/i })).not.toBeInTheDocument();
  });

  it("records at the 30 s user-clip cap, not the 20 s game cap", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: /film it/i }));
    expect(screen.getByTestId("recorder")).toHaveAttribute("data-max", "30");
  });

  it("posts a recorded clip: upload first, then the Firestore doc", async () => {
    const user = userEvent.setup();
    const { onPosted } = renderModal();

    await user.click(screen.getByRole("button", { name: /film it/i }));
    await user.click(screen.getByText("__take__"));

    await user.type(await screen.findByLabelText("TRICK"), "Nollie flip");
    await user.click(screen.getByRole("button", { name: /post clip/i }));

    await waitFor(() => expect(mockCreateUserClip).toHaveBeenCalled());
    expect(mockUploadUserClip).toHaveBeenCalledWith("me", "clip123", expect.any(Blob));
    expect(mockCreateUserClip).toHaveBeenCalledWith({
      clipId: "clip123",
      playerUsername: "viewer",
      trickName: "Nollie flip",
      videoUrl: "https://cdn/clip123.mp4",
      spotId: null,
    });
    expect(onPosted).toHaveBeenCalled();
  });

  it("blocks POST until the clip has a trick name", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: /film it/i }));
    await user.click(screen.getByText("__take__"));

    expect(await screen.findByRole("button", { name: /post clip/i })).toBeDisabled();

    await user.type(screen.getByLabelText("TRICK"), "Kickflip");
    expect(screen.getByRole("button", { name: /post clip/i })).toBeEnabled();
  });

  it("surfaces an error and stages nothing when the take produced no bytes", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: /film it/i }));
    await user.click(screen.getByText("__empty_take__"));

    expect(await screen.findByText(/didn't record/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("TRICK")).not.toBeInTheDocument();
  });

  it("accepts a valid picked file and moves to the naming step", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.upload(screen.getByTestId("user-clip-file-input"), goodFile());

    expect(await screen.findByLabelText("TRICK")).toBeInTheDocument();
    expect(mockProbe).toHaveBeenCalled();
  });

  it("rejects a file over the 30 s cap without uploading anything", async () => {
    const user = userEvent.setup();
    mockProbe.mockResolvedValue(45);
    renderModal();

    await user.upload(screen.getByTestId("user-clip-file-input"), goodFile());

    expect(await screen.findByText(/30 seconds or shorter/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("TRICK")).not.toBeInTheDocument();
    expect(mockUploadUserClip).not.toHaveBeenCalled();
  });

  it("rejects a non-video file before it ever reaches the duration probe", async () => {
    renderModal();
    const input = screen.getByTestId("user-clip-file-input") as HTMLInputElement;
    const png = new File(["x"], "a.png", { type: "image/png" });

    // `fireEvent`, not `user.upload`: user-event honours the `accept`
    // attribute and would refuse to attach the file, which is the one thing
    // this test must NOT rely on. `accept` is a picker hint an OS sheet can
    // ignore ("All files"), so the MIME re-check has to hold on its own.
    Object.defineProperty(input, "files", { value: [png], configurable: true });
    fireEvent.change(input);

    expect(await screen.findByText(/MP4 or WebM/i)).toBeInTheDocument();
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it("surfaces an upload failure and keeps the staged clip so the skater can retry", async () => {
    const user = userEvent.setup();
    mockUploadUserClip.mockRejectedValueOnce(new Error("Storage said no"));
    const { onPosted } = renderModal();

    await user.click(screen.getByRole("button", { name: /film it/i }));
    await user.click(screen.getByText("__take__"));
    await user.type(await screen.findByLabelText("TRICK"), "Kickflip");
    await user.click(screen.getByRole("button", { name: /post clip/i }));

    expect(await screen.findByText("Storage said no")).toBeInTheDocument();
    expect(mockCreateUserClip).not.toHaveBeenCalled();
    expect(onPosted).not.toHaveBeenCalled();
    expect(screen.getByLabelText("TRICK")).toHaveValue("Kickflip");
  });

  it("Retake discards the staged clip and returns to the source fork", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: /film it/i }));
    await user.click(screen.getByText("__take__"));
    await screen.findByLabelText("TRICK");

    await user.click(screen.getByRole("button", { name: /retake/i }));

    expect(screen.queryByLabelText("TRICK")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /film it/i })).toBeInTheDocument();
  });

  it("blocks a second post within the 30 s cooldown, before wasting an upload", async () => {
    const user = userEvent.setup();

    // First post — succeeds and arms the cooldown.
    const first = render(<UserClipUploadModal uid="me" username="viewer" onClose={vi.fn()} onPosted={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /film it/i }));
    await user.click(screen.getByText("__take__"));
    await user.type(await screen.findByLabelText("TRICK"), "Kickflip");
    await user.click(screen.getByRole("button", { name: /post clip/i }));
    await waitFor(() => expect(mockCreateUserClip).toHaveBeenCalledTimes(1));
    first.unmount();

    // Second attempt, immediately after. The modal reopens on a fresh mount,
    // which is exactly why the cooldown cannot live in component state.
    renderModal();
    await user.click(screen.getByRole("button", { name: /film it/i }));
    await user.click(screen.getByText("__take__"));
    await user.type(await screen.findByLabelText("TRICK"), "Heelflip");

    expect(await screen.findByRole("status")).toHaveTextContent(/wait \d+s before uploading another clip/i);
    expect(screen.getByRole("button", { name: /wait \d+s/i })).toBeDisabled();
    // Critically: nothing was uploaded on the blocked attempt.
    expect(mockUploadUserClip).toHaveBeenCalledTimes(1);
    expect(mockCreateUserClip).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

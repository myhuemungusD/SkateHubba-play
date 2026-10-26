import { beforeEach, describe, expect, it, vi } from "vitest";
import { within, render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  instances: [] as unknown[],
  throwOnCreate: false,
  seekRejects: false,
  playing: false,
}));

vi.mock("../../../lib/clipEditor/engine", () => ({
  EditorEngine: vi.fn(function FakeEngine(this: Record<string, unknown>) {
    if (engine.throwOnCreate) throw new Error("no webgl");
    Object.assign(this, {
      setSources: vi.fn(),
      setProject: vi.fn(),
      loadAudio: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn(async () => {
        if (engine.seekRejects) throw new Error("draw failed");
      }),
      play: vi.fn(async () => {
        engine.playing = true;
      }),
      pause: vi.fn(() => {
        engine.playing = false;
      }),
      destroy: vi.fn(),
    });
    Object.defineProperty(this, "isPlaying", { get: () => engine.playing });
    engine.instances.push(this);
  }),
}));

const readAngle = vi.hoisted(() => vi.fn());
vi.mock("../readAngle", () => ({ readAngle }));

const exportClip = vi.hoisted(() => vi.fn());
vi.mock("../exportClip", async (orig) => ({ ...(await orig<typeof import("../exportClip")>()), exportClip }));

const support = vi.hoisted(() => vi.fn());
vi.mock("../../../services/clipEditorNative", () => ({ getNativeEditorSupport: support }));

import { ClipEditor } from "../ClipEditor";

const angle = (id = "main", label = "Angle 1") => ({
  angle: { id, label, durationSec: 10, offsetSec: 0, width: 1920, height: 1080, fps: 60 },
  url: `blob:${id}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  engine.instances = [];
  engine.throwOnCreate = false;
  engine.seekRejects = false;
  engine.playing = false;
  readAngle.mockImplementation(async (_b: Blob, id: string, label: string) => angle(id, label));
  support.mockResolvedValue({ available: false, supports4k: false, supports60: false });
  vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: vi.fn() }));
});

const renderEditor = () => {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(<ClipEditor blob={new Blob(["x"], { type: "video/mp4" })} onDone={onDone} onCancel={onCancel} />);
  return { onDone, onCancel };
};

describe("ClipEditor", () => {
  it("loads the clip, switches tabs, plays/pauses and exports", async () => {
    exportClip.mockResolvedValue({ blob: new Blob(["edited"]), savedFullQuality: false });
    const { onDone } = renderEditor();
    await screen.findByRole("tab", { name: "Trim" });
    expect(engine.instances).toHaveLength(1);
    for (const t of ["Look", "Text", "Music", "Sounds", "Angles", "Trim"]) {
      fireEvent.click(screen.getByRole("tab", { name: t }));
      expect(screen.getByRole("tab", { name: t })).toHaveAttribute("aria-selected", "true");
    }
    await act(async () => fireEvent.click(screen.getByLabelText("Play")));
    engine.playing = true;
    await act(async () => fireEvent.click(screen.getByLabelText("Play")));
    expect(engine.playing).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Music" }));
    fireEvent.click(screen.getByText("Rail Ride"));
    fireEvent.click(screen.getByRole("tab", { name: "Sounds" }));
    fireEvent.click(screen.getByLabelText("Hear Bail"));
    fireEvent.click(screen.getByRole("button", { name: /^ADD BAIL AT/ }));
    // Adding opens the sound for trimming.
    expect(screen.getByTestId("sfx-inspector")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Sound end" }), { key: "ArrowLeft", shiftKey: true });
    expect(screen.getByRole("slider", { name: "Sound end" })).toHaveAttribute("aria-valuenow", "0.8");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByTestId("sfx-inspector")).toBeNull();
    expect(screen.queryByLabelText(/^Bail at/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Sounds" }));
    fireEvent.drop(screen.getByTestId("sfx-lane"), {
      dataTransfer: { getData: (t: string) => (t === "application/x-skatehubba-sfx" ? "flick" : "") },
    });
    const sfx = screen.getByLabelText(/^Flick at/);
    fireEvent.keyDown(sfx, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByLabelText(/^Flick at/), { key: "Enter" });
    fireEvent.click(within(screen.getByTestId("sfx-inspector")).getByText("Done"));
    expect(screen.queryByTestId("sfx-inspector")).toBeNull();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Playhead" }), { key: "End" });

    fireEvent.click(screen.getByText("Done"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export" })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("adds an angle from the file picker", async () => {
    renderEditor();
    await screen.findByRole("tab", { name: "Angles" });
    fireEvent.click(screen.getByRole("tab", { name: "Angles" }));
    const file = new File(["y"], "b.mp4", { type: "video/mp4" });
    await act(async () =>
      fireEvent.change(screen.getByTestId("clip-editor-angle-input"), { target: { files: [file] } }),
    );
    expect(await screen.findByText("Cut to Angle 2")).toBeInTheDocument();
    await act(async () => fireEvent.change(screen.getByTestId("clip-editor-angle-input"), { target: { files: [] } }));
  });

  it("shows an error when an extra angle can't be read", async () => {
    renderEditor();
    await screen.findByRole("tab", { name: "Angles" });
    readAngle.mockRejectedValueOnce(new Error("bad"));
    await act(async () =>
      fireEvent.change(screen.getByTestId("clip-editor-angle-input"), {
        target: { files: [new File(["z"], "z.mp4")] },
      }),
    );
    expect(await screen.findByText("Couldn't open that angle.")).toBeInTheDocument();
  });

  it("uses native caps when the plugin is present and reports export failure", async () => {
    support.mockResolvedValue({ available: true, supports4k: true, supports60: true });
    exportClip.mockRejectedValue(new Error("x"));
    renderEditor();
    await screen.findByRole("tab", { name: "Export" });
    fireEvent.click(screen.getByRole("tab", { name: "Export" }));
    await waitFor(() => expect(screen.getByText("4K")).not.toBeDisabled());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export" })));
    expect(await screen.findByText(/Export failed/)).toBeInTheDocument();
  });

  it("explains when the clip can't be opened, and Escape cancels", async () => {
    readAngle.mockRejectedValueOnce(new Error("bad"));
    const { onCancel } = renderEditor();
    expect(await screen.findByText("Couldn't open this clip.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("Escape on the error screen goes back without reaching the upload window", async () => {
    readAngle.mockRejectedValueOnce(new Error("bad"));
    const onDone = vi.fn();
    const onCancel = vi.fn();
    // Stands in for UserClipUploadModal, whose own Escape closes the whole upload.
    const hostKeyDown = vi.fn();
    const hostClick = vi.fn();
    render(
      <div onKeyDown={hostKeyDown} onClick={hostClick}>
        <ClipEditor blob={new Blob(["x"], { type: "video/mp4" })} onDone={onDone} onCancel={onCancel} />
      </div>,
    );
    const alert = await screen.findByRole("alertdialog");
    fireEvent.keyDown(alert, { key: "Escape" });
    fireEvent.keyDown(alert, { key: "a" });
    fireEvent.click(alert);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(hostKeyDown).not.toHaveBeenCalled();
    expect(hostClick).not.toHaveBeenCalled();
  });

  it("shows an error instead of an unhandled rejection when the first seek fails", async () => {
    engine.seekRejects = true;
    renderEditor();
    expect(await screen.findByText("Couldn't open this clip.")).toBeInTheDocument();
  });

  it("keeps the editor open and logs when a scrub seek fails", async () => {
    const { logger } = await import("../../../services/logger");
    const warn = vi.spyOn(logger, "warn");
    renderEditor();
    const slider = await screen.findByRole("slider", { name: "Playhead" });
    engine.seekRejects = true;
    await act(async () => fireEvent.keyDown(slider, { key: "ArrowRight" }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith("clip_editor_seek_failed", { error: "Error: draw failed" }));
    expect(screen.queryByText("Couldn't open this clip.")).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Playhead" })).toBeInTheDocument();
  });

  it("explains when WebGL is missing", async () => {
    engine.throwOnCreate = true;
    renderEditor();
    expect(await screen.findByText(/can't preview edits/)).toBeInTheDocument();
  });

  it("Escape and Cancel close the editor", async () => {
    const { onCancel } = renderEditor();
    await screen.findByRole("tab", { name: "Trim" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

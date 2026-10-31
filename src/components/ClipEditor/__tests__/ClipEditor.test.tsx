import { beforeEach, describe, expect, it, vi } from "vitest";
import { within, render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  instances: [] as unknown[],
  throwOnCreate: false,
  seekRejects: false,
  loadAudioRejects: false,
  playing: false,
}));

vi.mock("../../../lib/clipEditor/engine", () => ({
  EditorEngine: vi.fn(function FakeEngine(this: Record<string, unknown>) {
    if (engine.throwOnCreate) throw new Error("no webgl");
    Object.assign(this, {
      setSources: vi.fn(),
      setProject: vi.fn(),
      loadAudio: vi.fn(async () => {
        if (engine.loadAudioRejects) throw new Error("decode failed");
      }),
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
import { EditorEngine } from "../../../lib/clipEditor/engine";

const angle = (id = "main", label = "Angle 1") => ({
  angle: { id, label, durationSec: 10, offsetSec: 0, width: 1920, height: 1080, fps: 60 },
  url: `blob:${id}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  engine.instances = [];
  engine.throwOnCreate = false;
  engine.seekRejects = false;
  engine.loadAudioRejects = false;
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

describe("ClipEditor lifecycle and timeline edges", () => {
  const clip = () => new Blob(["x"], { type: "video/mp4" });
  const noop = { onDone: vi.fn(), onCancel: vi.fn() };

  it("ignores a probe that finishes after the editor closed", async () => {
    let resolve!: (v: ReturnType<typeof angle>) => void;
    readAngle.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { unmount } = render(<ClipEditor blob={clip()} {...noop} />);
    unmount();
    await act(async () => resolve(angle()));
    expect(engine.instances).toHaveLength(0);
  });

  it("keeps the first engine when a new clip is probed", async () => {
    const { rerender } = render(<ClipEditor blob={clip()} {...noop} />);
    await screen.findByRole("tab", { name: "Trim" });
    rerender(<ClipEditor blob={clip()} {...noop} />);
    await waitFor(() => expect(readAngle).toHaveBeenCalledTimes(2));
    await screen.findByRole("tab", { name: "Trim" });
    expect(EditorEngine).toHaveBeenCalledTimes(1);
  });

  it("uses 1080p native caps when the device can't do 4K", async () => {
    support.mockResolvedValue({ available: true, supports4k: false, supports60: true });
    renderEditor();
    fireEvent.click(await screen.findByRole("tab", { name: "Export" }));
    // Stabilize is native-only, so it enabling proves the native caps landed.
    await waitFor(() => expect(screen.getByText(/Stabilize/)).not.toBeDisabled());
    expect(screen.getByText("4K")).toBeDisabled();
  });

  it("keeps editing when the music can't be decoded", async () => {
    engine.loadAudioRejects = true;
    renderEditor();
    fireEvent.click(await screen.findByRole("tab", { name: "Music" }));
    await act(async () => fireEvent.click(screen.getByText("Rail Ride")));
    const e = engine.instances[0] as { loadAudio: ReturnType<typeof vi.fn> };
    expect(e.loadAudio).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("tab", { name: "Music" })).toHaveAttribute("aria-selected", "true");
  });

  it("restarts from zero when Play is pressed at the end", async () => {
    renderEditor();
    await screen.findByRole("tab", { name: "Trim" });
    const setPlayhead = vi.mocked(EditorEngine).mock.calls[0][2] as (t: number) => void;
    act(() => setPlayhead(10));
    await act(async () => fireEvent.click(screen.getByLabelText("Play")));
    const e = engine.instances[0] as { play: ReturnType<typeof vi.fn> };
    expect(e.play).toHaveBeenCalledWith(0);
  });

  it("removes sounds from the lane, closing the inspector only for the selected one", async () => {
    renderEditor();
    await screen.findByRole("tab", { name: "Trim" });
    const lane = screen.getByTestId("sfx-lane");
    const drop = (id: string) =>
      fireEvent.drop(lane, {
        dataTransfer: { getData: (t: string) => (t === "application/x-skatehubba-sfx" ? id : "") },
      });
    drop("flick");
    drop("bail");
    fireEvent.keyDown(screen.getByLabelText(/^Bail at/), { key: "Enter" });
    expect(screen.getByTestId("sfx-inspector")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText(/^Flick at/), { key: "Delete" });
    expect(screen.queryByLabelText(/^Flick at/)).toBeNull();
    expect(screen.getByTestId("sfx-inspector")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText(/^Bail at/), { key: "Backspace" });
    expect(screen.queryByLabelText(/^Bail at/)).toBeNull();
    expect(screen.queryByTestId("sfx-inspector")).toBeNull();
  });

  it("opens the file picker from the Angles panel", async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole("tab", { name: "Angles" }));
    const input = screen.getByTestId("clip-editor-angle-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
    fireEvent.click(screen.getByText("+ Add angle"));
    expect(click).toHaveBeenCalledTimes(1);
  });
});

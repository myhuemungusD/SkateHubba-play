import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  instances: [] as unknown[],
  throwOnCreate: false,
  playing: false,
}));

vi.mock("../../../lib/clipEditor/engine", () => ({
  EditorEngine: vi.fn(function FakeEngine(this: Record<string, unknown>) {
    if (engine.throwOnCreate) throw new Error("no webgl");
    Object.assign(this, {
      setSources: vi.fn(),
      setProject: vi.fn(),
      loadAudio: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
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
    fireEvent.click(screen.getByLabelText(/Add Bail/));
    const sfx = screen.getByLabelText(/^Bail at/);
    fireEvent.keyDown(sfx, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByLabelText(/^Bail at/), { key: "Delete" });
    fireEvent.drop(screen.getByTestId("sfx-lane"), {
      dataTransfer: { getData: (t: string) => (t === "application/x-skatehubba-sfx" ? "flick" : "") },
    });
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

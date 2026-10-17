import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createProject } from "../../../lib/clipEditor/project";
import { placeSfx, trimSfx } from "../../../lib/clipEditor/overlays";
import type { EditProject } from "../../../lib/clipEditor/types";
import { SfxInspector } from "../SfxInspector";
import { peaksOf, loadPeaks, pickSfxSrc } from "../sfxAudio";

const withSfx = (): EditProject =>
  placeSfx(
    createProject({ id: "m", label: "A", durationSec: 10, offsetSec: 0, width: 1, height: 1, fps: 30 }),
    "landing",
    2,
  );
const last = (fn: ReturnType<typeof vi.fn>): EditProject => fn.mock.calls.at(-1)?.[0] as EditProject;

function setup(p = withSfx()) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const r = render(<SfxInspector project={p} sfxId={p.sfx[0].id} onChange={onChange} onClose={onClose} />);
  return { p, onChange, onClose, r };
}

describe("SfxInspector", () => {
  it("renders nothing for an unknown placement", () => {
    const p = withSfx();
    const { container } = render(<SfxInspector project={p} sfxId="nope" onChange={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("trims with keyboard and by dragging the handles on the waveform", () => {
    const { p, onChange } = setup();
    const id = p.sfx[0].id;
    const start = screen.getByRole("slider", { name: "Sound start" });
    const end = screen.getByRole("slider", { name: "Sound end" });
    expect(end).toHaveAttribute("aria-valuenow", "0.9");
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(last(onChange).sfx[0]).toMatchObject({ id, trimStartSec: 0.01, trimEndSec: 0.9 });
    fireEvent.keyDown(end, { key: "ArrowDown", shiftKey: true });
    expect(last(onChange).sfx[0].trimEndSec).toBeCloseTo(0.8);
    fireEvent.keyDown(end, { key: "ArrowUp" });
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    const n = onChange.mock.calls.length;
    fireEvent.keyDown(start, { key: "q" });
    expect(onChange).toHaveBeenCalledTimes(n);

    const wave = screen.getByLabelText(/Waveform/);
    wave.getBoundingClientRect = () =>
      ({ left: 0, width: 90, top: 0, height: 10, right: 90, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(start, { clientX: 10 });
    expect(onChange).toHaveBeenCalledTimes(n);
    fireEvent.pointerDown(start, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(start, { clientX: 30, pointerId: 1 });
    expect(last(onChange).sfx[0].trimStartSec).toBeCloseTo(0.3);
    fireEvent.pointerUp(start);
    fireEvent.pointerDown(end, { clientX: 90, pointerId: 1 });
    fireEvent.pointerMove(end, { clientX: 45, pointerId: 1 });
    expect(last(onChange).sfx[0].trimEndSec).toBeCloseTo(0.45);
    fireEvent.pointerCancel(end);
  });

  it("shows the trimmed length, sets volume, previews, deletes and closes", () => {
    const base = withSfx();
    const p = trimSfx(base, base.sfx[0].id, 0.2, 0.6);
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const fake: Record<string, unknown> = { play, pause, currentTime: 0, volume: 1 };
    vi.stubGlobal(
      "Audio",
      vi.fn(function FakeAudio() {
        return fake;
      }),
    );
    const { onChange, onClose } = setup(p);
    expect(screen.getByText(/Plays 0.40s of 0.90s/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: /Volume/ }), { target: { value: "1.5" } });
    expect(last(onChange).sfx[0].gain).toBe(1.5);
    fireEvent.click(screen.getByRole("button", { name: "▶ Hear" }));
    expect(fake.currentTime).toBe(0.2);
    expect(play).toHaveBeenCalled();
    fake.currentTime = 0.7;
    (fake.ontimeupdate as () => void)();
    expect(pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(last(onChange).sfx).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("draws decoded peaks when the browser can decode the file", async () => {
    const data = new Float32Array([0, 0.5, -1, 0.25]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }));
    vi.stubGlobal(
      "OfflineAudioContext",
      vi.fn(function Ctx() {
        return { decodeAudioData: () => Promise.resolve({ getChannelData: () => data }) };
      }),
    );
    expect(await loadPeaks("/editor/sfx/x.m4a", 4)).toEqual([0, 0.5, 1, 0.25]);
    expect(await loadPeaks("/editor/sfx/x.m4a", 4)).toEqual([0, 0.5, 1, 0.25]);
    vi.stubGlobal(
      "OfflineAudioContext",
      vi.fn(function Ctx() {
        return { decodeAudioData: () => Promise.reject(new Error("bad")) };
      }),
    );
    expect(await loadPeaks("/editor/sfx/y.m4a", 4)).toBeNull();
    setup();
    await waitFor(() => expect(screen.getByTestId("sfx-inspector")).toBeInTheDocument());
    vi.unstubAllGlobals();
    expect(await loadPeaks("/editor/sfx/z.m4a")).toBeNull();
  });

  it("peaksOf normalizes and pickSfxSrc prefers AAC", () => {
    expect(peaksOf(new Float32Array([0.1, -0.2, 0.4, 0.2]), 2)).toEqual([0.5, 1]);
    expect(peaksOf(new Float32Array(0), 2)).toEqual([0, 0]);
    expect(pickSfxSrc({ src: "a.m4a" })).toBe("a.m4a");
    const spy = vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    expect(pickSfxSrc({ src: "a.m4a", oggSrc: "a.ogg" })).toBe("a.m4a");
    spy.mockReturnValue("");
    expect(pickSfxSrc({ src: "a.m4a", oggSrc: "a.ogg" })).toBe("a.ogg");
    spy.mockRestore();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createProject, addAngle, addCut } from "../../../lib/clipEditor/project";
import { placeSfx, MAX_SFX } from "../../../lib/clipEditor/overlays";
import type { EditProject, SfxPlacement } from "../../../lib/clipEditor/types";
import { SoundsPanel } from "../AudioPanels";
import { AnglesPanel } from "../AnglesExportPanels";
import { Timeline } from "../Timeline";
import { SfxInspector } from "../SfxInspector";
import { loadPeaks } from "../sfxAudio";

// Passthrough library with two credited sources (the shipped library has one)
// and a zero-length "silent" sound, so the separator and divide-by-zero guards run.
vi.mock("../../../lib/clipEditor/sfxLibrary", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/clipEditor/sfxLibrary")>();
  return {
    ...real,
    soundCredits: () => [
      ...real.soundCredits().slice(0, 1),
      { author: "Second Author", title: "Push Loop", url: "https://example.test/push", license: "CC0" },
    ],
    getSound: (id: string) =>
      id === "silent"
        ? { ...real.getSound("bail")!, id: "silent", label: "Silent", durationSec: 0 }
        : real.getSound(id),
  };
});

const project = (durationSec = 10): EditProject =>
  createProject({ id: "main", label: "Angle 1", durationSec, offsetSec: 0, width: 1920, height: 1080, fps: 60 });
const angle2 = { id: "angle-2", label: "Angle 2", durationSec: 10, offsetSec: 0, width: 1920, height: 1080, fps: 60 };
const rect = (width: number) => () =>
  ({ left: 0, width, top: 0, height: 10, right: width, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

interface FakeAudioInstance {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  currentTime: number;
  volume: number;
  ontimeupdate: (() => void) | null;
}
function stubRejectingAudio(): FakeAudioInstance[] {
  const made: FakeAudioInstance[] = [];
  vi.stubGlobal(
    "Audio",
    vi.fn(function FakeAudio() {
      const a: FakeAudioInstance = {
        play: vi.fn(() => Promise.reject(new Error("autoplay blocked"))),
        pause: vi.fn(),
        currentTime: 0,
        volume: 1,
        ontimeupdate: null,
      };
      made.push(a);
      return a;
    }),
  );
  return made;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SoundsPanel edges", () => {
  it("swallows a blocked preview, joins several credits, and skips onAdded when the lane is full", async () => {
    const made = stubRejectingAudio();
    let full = project();
    for (let i = 0; i < MAX_SFX; i++) full = placeSfx(full, "bail", i * 0.1);
    expect(full.sfx).toHaveLength(MAX_SFX);
    const onChange = vi.fn();
    const onAdded = vi.fn();
    render(<SoundsPanel project={full} onChange={onChange} sourceTime={1} outputTime={1} onAdded={onAdded} />);

    fireEvent.click(screen.getByLabelText("Hear Bail"));
    expect(made[0].play).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    fireEvent.click(screen.getByRole("button", { name: /^ADD BAIL AT/ }));
    expect(onChange).toHaveBeenCalledWith(full);
    expect(onAdded).not.toHaveBeenCalled();

    const credits = screen.getByTestId("sfx-credits");
    expect(credits.textContent).toContain("“Skateboarding Tricks” by SoundBiterSFX");
    expect(credits.textContent).toContain("; “Push Loop” by Second Author");
    expect(credits.querySelectorAll("a")).toHaveLength(2);
  });
});

describe("AnglesPanel cut count", () => {
  it("says how many cuts there are, singular and plural", () => {
    const two = addAngle(project(), angle2);
    const oneCut = addCut(two, 3, "angle-2");
    const { rerender } = render(
      <AnglesPanel project={oneCut} onChange={vi.fn()} sourceTime={5} outputTime={5} beats={[]} onAddAngle={vi.fn()} />,
    );
    expect(screen.getByText(/ 1 cut\.$/)).toBeInTheDocument();
    const twoCuts = addCut(oneCut, 6, "main");
    rerender(
      <AnglesPanel
        project={twoCuts}
        onChange={vi.fn()}
        sourceTime={5}
        outputTime={5}
        beats={[]}
        onAddAngle={vi.fn()}
      />,
    );
    expect(screen.getByText(/ 2 cuts\.$/)).toBeInTheDocument();
  });
});

describe("Timeline edges", () => {
  const handlers = () => ({
    onSeek: vi.fn(),
    onDropSfx: vi.fn(),
    onMoveSfx: vi.fn(),
    onRemoveSfx: vi.fn(),
  });

  it("maps a pointer on a measured lane to seconds and ignores drops with no payload", () => {
    const h = handlers();
    render(<Timeline project={project()} playhead={0} beats={[]} {...h} />);
    const scrub = screen.getByRole("slider", { name: "Playhead" });
    scrub.parentElement!.getBoundingClientRect = rect(200);
    fireEvent.pointerDown(scrub, { clientX: 50 });
    expect(h.onSeek).toHaveBeenCalledWith(2.5);
    fireEvent.pointerDown(scrub, { clientX: 999 });
    expect(h.onSeek).toHaveBeenLastCalledWith(10);

    fireEvent.drop(screen.getByTestId("sfx-lane"), { dataTransfer: { getData: () => "" } });
    expect(h.onDropSfx).not.toHaveBeenCalled();
    expect(h.onMoveSfx).not.toHaveBeenCalled();
  });

  it("treats an unmeasurable lane as zero seconds when dragging a sound", () => {
    const h = handlers();
    const p = placeSfx(project(), "bail", 4);
    render(<Timeline project={p} playhead={0} beats={[]} {...h} />);
    const lane = screen.getByRole("slider", { name: "Playhead" }).parentElement!;
    const clip = screen.getByTestId("sfx-clip");
    // jsdom's default rect has width 0.
    fireEvent.pointerDown(clip, { clientX: 0 });
    fireEvent.pointerMove(clip, { clientX: 40 });
    expect(h.onMoveSfx).toHaveBeenLastCalledWith(p.sfx[0].id, 4);
    // A rect that reports no width at all.
    lane.getBoundingClientRect = () => ({ left: 0 }) as DOMRect;
    fireEvent.pointerMove(clip, { clientX: 80 });
    expect(h.onMoveSfx).toHaveBeenLastCalledWith(p.sfx[0].id, 4);
    fireEvent.pointerUp(clip);
  });

  it("labels a sound missing from the library by its id and survives a zero-length edit", () => {
    const h = handlers();
    const ghost: SfxPlacement = { id: "sfx-x", soundId: "retired-sound", outAtSec: 0, gain: 1 };
    render(<Timeline project={{ ...project(0), sfx: [ghost] }} playhead={0} beats={[0]} {...h} />);
    const clip = screen.getByTestId("sfx-clip");
    expect(clip).toHaveTextContent("retired-sound");
    expect(clip).toHaveAccessibleName(/^retired-sound at 0\.00s/);
    expect(clip.style.left).toBe("0%");
  });
});

describe("SfxInspector edges", () => {
  it("previews the trimmed span, stops at its end, and tolerates a blocked play", async () => {
    const made = stubRejectingAudio();
    const p = placeSfx(project(), "bail", 2);
    render(<SfxInspector project={p} sfxId={p.sfx[0].id} onChange={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /hear/i }));
    const a = made[0];
    expect(a.play).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    a.currentTime = 0.1;
    a.ontimeupdate?.();
    expect(a.pause).not.toHaveBeenCalled();
    a.currentTime = 99;
    a.ontimeupdate?.();
    expect(a.pause).toHaveBeenCalledTimes(1);
  });

  it("drags a handle to zero on an unmeasured waveform and lays out a zero-length sound", () => {
    const p = placeSfx(project(), "silent", 1);
    const onChange = vi.fn();
    render(<SfxInspector project={p} sfxId={p.sfx[0].id} onChange={onChange} onClose={vi.fn()} />);
    const end = screen.getByRole("slider", { name: "Sound end" });
    expect(end).toHaveAttribute("aria-valuemax", "0");
    fireEvent.pointerDown(end, { clientX: 5 });
    fireEvent.pointerMove(end, { clientX: 30 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as EditProject).sfx[0].soundId).toBe("silent");
  });
});

describe("loadPeaks without a window", () => {
  it("returns null during SSR, before touching fetch or Web Audio", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("window", undefined);
    const pending = loadPeaks("/editor/sfx/ssr-only.m4a");
    vi.unstubAllGlobals();
    await expect(pending).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createProject, setLanding, addCut, addAngle } from "../../../lib/clipEditor/project";
import { placeSfx } from "../../../lib/clipEditor/overlays";
import type { EditProject } from "../../../lib/clipEditor/types";
import { WEB_CAPABILITIES, NATIVE_CAPABILITIES } from "../../../lib/clipEditor/exportPlan";
import { TrimSpeedPanel, LookPanel, TextPanel } from "../EditPanels";
import { MusicPanel, SoundsPanel } from "../AudioPanels";
import { AnglesPanel, ExportPanel } from "../AnglesExportPanels";
import { Timeline, SFX_DRAG_TYPE } from "../Timeline";
import { Chip, PanelHeading } from "../Chip";

const base = (): EditProject =>
  createProject({ id: "main", label: "Angle 1", durationSec: 10, offsetSec: 0, width: 1920, height: 1080, fps: 60 });
const props = (project = base()) => ({ project, onChange: vi.fn(), sourceTime: 5, outputTime: 5 });
const last = (fn: ReturnType<typeof vi.fn>): EditProject => fn.mock.calls.at(-1)?.[0] as EditProject;

describe("Chip", () => {
  it("renders pressed state and heading", () => {
    const onClick = vi.fn();
    render(
      <>
        <PanelHeading>H</PanelHeading>
        <Chip selected onClick={onClick}>
          A
        </Chip>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("TrimSpeedPanel", () => {
  it("trims, marks landing and applies ramps", () => {
    const p = props();
    const { rerender } = render(<TrimSpeedPanel {...p} />);
    fireEvent.click(screen.getByText("Start here"));
    expect(last(p.onChange).trimInSec).toBe(5);
    fireEvent.click(screen.getByText("End here"));
    expect(last(p.onChange).trimOutSec).toBe(5);
    fireEvent.click(screen.getByText("Mark landing"));
    expect(last(p.onChange).landingSec).toBe(5);
    expect(screen.getByText("Slow the trick")).toBeDisabled();

    const landed = { ...p, project: setLanding(base(), 5) };
    rerender(<TrimSpeedPanel {...landed} />);
    fireEvent.click(screen.getByText("Trim to trick"));
    expect(last(p.onChange).trimInSec).toBe(2.5);
    fireEvent.click(screen.getByText("Slow the trick"));
    expect(last(p.onChange).speed.length).toBeGreaterThan(1);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.5" } });
    expect(screen.getByText(/Slow-mo amount: 50%/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Real time"));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.125" } });
    expect(last(p.onChange).speed).toEqual([{ atSec: 0, speed: 1 }]);
  });
});

describe("LookPanel", () => {
  it("picks looks, strength and color", () => {
    const p = props({ ...base(), look: "vhs" });
    render(<LookPanel {...p} />);
    fireEvent.click(screen.getByText("VX1000"));
    expect(last(p.onChange).look).toBe("vx1000");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.4" } });
    expect(last(p.onChange).lookStrength).toBe(0.4);
    fireEvent.click(screen.getByText("Golden hour"));
    expect(last(p.onChange).color).toBe("golden");
  });
});

describe("TextPanel", () => {
  it("adds and removes captions", () => {
    const p = props();
    const { rerender } = render(<TextPanel {...p} />);
    expect(screen.getByText(/Add at/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Trick name caption"), { target: { value: "Tre flip" } });
    fireEvent.click(screen.getByText("Label tape"));
    fireEvent.click(screen.getByText(/Add at/));
    const withText = last(p.onChange);
    expect(withText.overlays[0]).toMatchObject({ text: "Tre flip", style: "tape" });
    rerender(<TextPanel {...p} project={withText} />);
    fireEvent.click(screen.getByLabelText("Remove caption Tre flip"));
    expect(last(p.onChange).overlays).toHaveLength(0);
  });
});

describe("MusicPanel", () => {
  it("picks a track, syncs to landing, adjusts original sound, removes music", () => {
    const p = props(setLanding(base(), 5));
    const { rerender } = render(<MusicPanel {...p} />);
    fireEvent.click(screen.getByText("Rail Ride"));
    const withMusic = last(p.onChange);
    expect(withMusic.music?.trackId).toBe("breaks-128");
    rerender(<MusicPanel {...p} project={withMusic} />);
    expect(screen.getByText(/Synced/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.2" } });
    expect(last(p.onChange).music?.originalGain).toBe(0.2);
    fireEvent.click(screen.getByText("No music"));
    expect(last(p.onChange).music).toBeNull();
  });

  it("asks for a landing when none is marked", () => {
    const p = props();
    const { rerender } = render(<MusicPanel {...p} />);
    fireEvent.click(screen.getByText("Curb Cut"));
    rerender(<MusicPanel {...p} project={last(p.onChange)} />);
    expect(screen.getByText(/Mark the landing/)).toBeInTheDocument();
  });
});

describe("SoundsPanel", () => {
  it("taps to place, drags with the sfx type, long-press previews", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    vi.stubGlobal(
      "Audio",
      vi.fn(function FakeAudio() {
        return { play, pause };
      }),
    );
    const p = props();
    render(<SoundsPanel {...p} />);
    const btn = screen.getByLabelText(/Add Ollie pop/);
    fireEvent.click(btn);
    expect(last(p.onChange).sfx[0].soundId).toBe("ollie-pop");
    const setData = vi.fn();
    fireEvent.dragStart(btn, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(SFX_DRAG_TYPE, "ollie-pop");
    fireEvent.contextMenu(btn);
    fireEvent.contextMenu(btn);
    expect(play).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("AnglesPanel", () => {
  it("cuts (snapping to beats), adds and removes angles", () => {
    const onAddAngle = vi.fn();
    const proj = addAngle(base(), {
      id: "b",
      label: "Angle 2",
      durationSec: 10,
      offsetSec: 0,
      width: 1920,
      height: 1080,
      fps: 60,
    });
    const p = props(addCut(proj, 2, "b"));
    const { rerender } = render(<AnglesPanel {...p} beats={[]} onAddAngle={onAddAngle} />);
    fireEvent.click(screen.getByText("Cut to Angle 2"));
    expect(last(p.onChange).cuts.some((c) => c.atSec === 5)).toBe(true);
    rerender(<AnglesPanel {...p} beats={[4.8]} onAddAngle={onAddAngle} />);
    fireEvent.click(screen.getByText("Cut to Angle 1"));
    expect(last(p.onChange).cuts.some((c) => Math.abs(c.atSec - 4.8) < 1e-6)).toBe(true);
    fireEvent.click(screen.getByLabelText("Remove Angle 2"));
    expect(last(p.onChange).angles).toHaveLength(1);
    fireEvent.click(screen.getByText("+ Add angle"));
    expect(onAddAngle).toHaveBeenCalled();
    expect(screen.getByText(/1 cut\./)).toBeInTheDocument();
  });
});

describe("ExportPanel", () => {
  it("web: 4K disabled, stabilize disabled, exports", () => {
    const onExport = vi.fn();
    const p = props();
    const { rerender } = render(
      <ExportPanel {...p} caps={WEB_CAPABILITIES} exporting={false} progress={0} onExport={onExport} />,
    );
    expect(screen.getByText("4K")).toBeDisabled();
    expect(screen.getByText(/Stabilize/)).toBeDisabled();
    fireEvent.click(screen.getByText("720p"));
    expect(last(p.onChange).export.resolution).toBe("720p");
    fireEvent.click(screen.getByText("30 fps"));
    expect(last(p.onChange).export.fps).toBe(30);
    fireEvent.click(screen.getByText("Export"));
    expect(onExport).toHaveBeenCalled();
    rerender(<ExportPanel {...p} caps={WEB_CAPABILITIES} exporting progress={0.42} onExport={onExport} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("native: 4K + stabilize available, warns when over the upload cap", () => {
    const p = props({ ...base(), export: { resolution: "4k", fps: 60 } });
    render(<ExportPanel {...p} caps={NATIVE_CAPABILITIES} exporting={false} progress={0} onExport={vi.fn()} />);
    fireEvent.click(screen.getByText(/Stabilize/));
    expect(last(p.onChange).stabilize).toBe(true);
    expect(screen.getByText(/full-quality file saves to your camera roll/)).toBeInTheDocument();
  });
});

describe("Timeline", () => {
  const setup = (project = base()) => {
    const h = { onSeek: vi.fn(), onDropSfx: vi.fn(), onMoveSfx: vi.fn(), onRemoveSfx: vi.fn() };
    const r = render(<Timeline project={project} playhead={2} beats={[0, 1, 2]} {...h} />);
    return { ...h, ...r };
  };

  it("scrubs with keys and pointer", () => {
    const h = setup();
    const slider = screen.getByRole("slider", { name: "Playhead" });
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(h.onSeek).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(h.onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(h.onSeek).toHaveBeenLastCalledWith(10);
    fireEvent.keyDown(slider, { key: "a" });
    fireEvent.pointerDown(slider, { clientX: 50 });
    expect(h.onSeek).toHaveBeenLastCalledWith(0);
  });

  it("shows landing + cuts and handles sfx drop/move/delete", () => {
    let p = setLanding(base(), 5);
    p = addAngle(p, { id: "b", label: "B", durationSec: 10, offsetSec: 0, width: 1, height: 1, fps: 30 });
    p = addCut(p, 3, "b");
    p = placeSfx(p, "landing", 5);
    const h = setup(p);
    expect(screen.getByTestId("landing-marker")).toBeInTheDocument();
    const lane = screen.getByTestId("sfx-lane");
    fireEvent.dragOver(lane);
    fireEvent.drop(lane, { dataTransfer: { getData: (t: string) => (t === SFX_DRAG_TYPE ? "bail" : "") } });
    expect(h.onDropSfx).toHaveBeenCalledWith("bail", 0);
    fireEvent.drop(lane, { dataTransfer: { getData: (t: string) => (t === "text/sfx-placement" ? "x1" : "") } });
    expect(h.onMoveSfx).toHaveBeenCalledWith("x1", 0);
    const chip = screen.getByLabelText(/Landing at 5.00s/);
    fireEvent.keyDown(chip, { key: "ArrowRight" });
    fireEvent.keyDown(chip, { key: "ArrowLeft" });
    expect(h.onMoveSfx).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(chip, { key: "Delete" });
    expect(h.onRemoveSfx).toHaveBeenCalled();
    fireEvent.keyDown(chip, { key: "x" });
    const setData = vi.fn();
    fireEvent.dragStart(chip, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("text/sfx-placement", p.sfx[0].id);
  });
});

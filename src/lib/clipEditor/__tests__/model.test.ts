import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProject,
  setTrim,
  setLanding,
  trimToTrick,
  addAngle,
  removeAngle,
  addCut,
  angleAt,
  MIN_TRIM_SEC,
  buildSpeedRamp,
  setSpeedKeys,
  speedAt,
  speedSegments,
  sourceToOutput,
  outputToSource,
  outputDuration,
  SPEED_RAMP_PRESETS,
  beatGrid,
  snapToBeat,
  alignMusicToLanding,
  LOOKS,
  lookParams,
  COLOR_PRESETS,
  SKATE_SOUNDS,
  getSound,
  MUSIC_TRACKS,
  getTrack,
  addOverlay,
  removeOverlay,
  overlaysAt,
  placeSfx,
  moveSfx,
  removeSfx,
  MAX_SFX,
  planExport,
  allowedResolutions,
  bitrateFor,
  WEB_CAPABILITIES,
  NATIVE_CAPABILITIES,
  type EditorAngle,
  type EditProject,
} from "..";
import { colorMatrixUniforms, pillarFor } from "../shader";

const angle = (over: Partial<EditorAngle> = {}): EditorAngle => ({
  id: "main",
  label: "Angle 1",
  durationSec: 10,
  offsetSec: 0,
  width: 1920,
  height: 1080,
  fps: 60,
  ...over,
});

const base = (): EditProject => createProject(angle());

describe("project", () => {
  it("creates a real-time, untrimmed project and picks 60fps for high-frame-rate sources", () => {
    const p = base();
    expect(p.trimOutSec).toBe(10);
    expect(p.export).toEqual({ resolution: "1080p", fps: 60 });
    expect(createProject(angle({ fps: 30 })).export.fps).toBe(30);
  });

  it("clamps, orders and enforces a minimum trim", () => {
    expect(setTrim(base(), 8, 2)).toMatchObject({ trimInSec: 2, trimOutSec: 8 });
    const tiny = setTrim(base(), 9.9, 10);
    expect(tiny.trimOutSec - tiny.trimInSec).toBeCloseTo(MIN_TRIM_SEC);
    expect(setTrim(base(), -5, 50)).toMatchObject({ trimInSec: 0, trimOutSec: 10 });
  });

  it("keeps the landing inside the trim", () => {
    const p = setLanding(base(), 9);
    expect(setTrim(p, 1, 5).landingSec).toBe(5);
    expect(setLanding(p, null).landingSec).toBeNull();
  });

  it("trims to the trick around the landing", () => {
    expect(trimToTrick(base())).toEqual(base());
    const p = trimToTrick(setLanding(base(), 5));
    expect(p).toMatchObject({ trimInSec: 2.5, trimOutSec: 6.5, landingSec: 5 });
  });

  it("manages angles and cuts", () => {
    let p = addAngle(base(), angle({ id: "b", label: "Angle 2" }));
    expect(addAngle(p, angle({ id: "b" }))).toBe(p);
    p = addCut(p, 3, "b");
    p = addCut(p, 1, "main");
    p = addCut(p, 3, "b");
    expect(p.cuts.map((c) => c.atSec)).toEqual([1, 3]);
    expect(addCut(p, 2, "nope")).toBe(p);
    expect(angleAt(p, 0.5).id).toBe("main");
    expect(angleAt(p, 4).id).toBe("b");
    expect(removeAngle(p, "main")).toBe(p);
    const r = removeAngle(p, "b");
    expect(r.angles).toHaveLength(1);
    expect(r.cuts).toHaveLength(1);
    let full = p;
    for (const id of ["c", "d", "e"]) full = addAngle(full, angle({ id }));
    expect(full.angles).toHaveLength(4);
  });
});

describe("speed", () => {
  it("lists presets and returns real time without a landing", () => {
    expect(SPEED_RAMP_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(buildSpeedRamp("landing-slowmo", null)).toEqual([{ atSec: 0, speed: 1 }]);
    expect(buildSpeedRamp("realtime", 5)).toEqual([{ atSec: 0, speed: 1 }]);
  });

  it.each(["landing-slowmo", "pop-slowmo", "hammer", "fast-roll-in"] as const)(
    "%s ramps and lengthens or shortens output",
    (preset) => {
      const p = setSpeedKeys(base(), buildSpeedRamp(preset, 5));
      expect(p.speed[0].atSec).toBe(0);
      expect(outputDuration(p)).not.toBeCloseTo(10, 3);
    },
  );

  it("slow-mo through the landing makes the edit longer and maps time both ways", () => {
    const p = setSpeedKeys(base(), [
      { atSec: 4, speed: 0.25 },
      { atSec: 6, speed: 1 },
    ]);
    expect(speedAt(p.speed, 5)).toBe(0.25);
    expect(outputDuration(p)).toBeCloseTo(4 + 8 + 4);
    for (const s of [0, 3, 4.5, 5.9, 8, 10]) expect(outputToSource(p, sourceToOutput(p, s))).toBeCloseTo(s);
    expect(outputToSource(p, 999)).toBe(10);
  });

  it("clamps speeds and clips segments to the trim", () => {
    const p = setSpeedKeys(base(), [{ atSec: 0, speed: 100 }]);
    expect(p.speed[0].speed).toBe(4);
    expect(speedSegments(p.speed, 2, 3)).toEqual([{ from: 2, to: 3, speed: 4 }]);
    expect(setSpeedKeys(base(), []).speed).toEqual([{ atSec: 0, speed: 1 }]);
  });
});

describe("beats", () => {
  it("builds a beat grid and snaps", () => {
    const g = beatGrid(120, 0, 2);
    expect(g).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(beatGrid(120, 0.25, 1)).toEqual([0.25, 0.75]);
    expect(beatGrid(0, 0, 2)).toEqual([]);
    expect(snapToBeat(0.6, g)).toBe(0.5);
    expect(snapToBeat(0.6, [])).toBe(0.6);
  });

  it("lands a downbeat on the landing", () => {
    expect(alignMusicToLanding(base(), 3)).toEqual(base());
    const unknown = { ...base(), music: { trackId: "x", trackOffsetSec: 0, gain: 1, originalGain: 1 } };
    expect(alignMusicToLanding(unknown, 3)).toBe(unknown);
    const p = { ...base(), music: { trackId: "breaks-128", trackOffsetSec: 0, gain: 1, originalGain: 1 } };
    const synced = alignMusicToLanding(p, 3.3);
    const bar = (60 / 128) * 4;
    const trackTime = 3.3 + (synced.music?.trackOffsetSec ?? 0);
    expect((trackTime / bar) % 1).toBeCloseTo(0, 3);
  });
});

describe("looks and color", () => {
  it("scales look strength and keeps framing flags", () => {
    expect(lookParams("vx1000", 0.5).barrel).toBeCloseTo(LOOKS.vx1000.params.barrel / 2);
    expect(lookParams("vx1000", 5).fourByThree).toBe(true);
    expect(lookParams("vhs", -1).grain).toBe(0);
  });

  it("every color preset is a 4x5 matrix and maps to shader uniforms", () => {
    for (const c of Object.values(COLOR_PRESETS)) expect(c.matrix).toHaveLength(20);
    const { mat, bias } = colorMatrixUniforms(COLOR_PRESETS.natural.matrix);
    expect(Array.from(mat)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(Array.from(bias)).toEqual([0, 0, 0, 0]);
  });

  it("pillarboxes 4:3 only when the frame is wider", () => {
    expect(pillarFor(LOOKS.vx1000.params, 1920, 1080)).toBeCloseTo(0.25);
    expect(pillarFor(LOOKS.vx1000.params, 1080, 1920)).toBe(0);
    expect(pillarFor(LOOKS.fisheye.params, 1920, 1080)).toBe(0);
    expect(pillarFor(LOOKS.vx1000.params, 1920, 0)).toBe(0);
  });
});

describe("libraries", () => {
  it("ships every requested skate sound, each with a file on disk", () => {
    const ids = SKATE_SOUNDS.map((s) => s.id);
    for (const id of [
      "ollie-pop",
      "flick",
      "landing",
      "grind-5050",
      "grind-crooked",
      "grind-smith",
      "slide-wood",
      "slide-concrete",
      "slide-metal",
      "wheel-roll",
      "powerslide",
      "bail",
      "crowd-hype",
    ]) {
      expect(ids).toContain(id);
    }
    for (const s of SKATE_SOUNDS) expect(existsSync(join(process.cwd(), "public", s.src))).toBe(true);
    expect(getSound("bail")?.category).toBe("board");
    expect(getSound("nope")).toBeUndefined();
  });

  it("music tracks exist on disk and are CC0 originals", () => {
    for (const t of MUSIC_TRACKS) {
      expect(existsSync(join(process.cwd(), "public", t.src))).toBe(true);
      expect(t.license).toMatch(/CC0/);
    }
    expect(getTrack("punk-170")?.bpm).toBe(170);
    expect(existsSync(join(process.cwd(), "public/editor/CREDITS.md"))).toBe(true);
  });
});

describe("overlays and sfx", () => {
  it("adds, finds and removes captions", () => {
    expect(addOverlay(base(), "   ", 2)).toEqual(base());
    const p = addOverlay(base(), "Kickflip", 5, "tape");
    const o = p.overlays[0];
    expect(o).toMatchObject({ text: "Kickflip", outStartSec: 4.25, outEndSec: 5.75, style: "tape" });
    expect(overlaysAt(p, 5)).toHaveLength(1);
    expect(overlaysAt(p, 6)).toHaveLength(0);
    expect(removeOverlay(p, o.id).overlays).toHaveLength(0);
  });

  it("places, moves, removes and caps sfx", () => {
    expect(placeSfx(base(), "nope", 1)).toEqual(base());
    let p = placeSfx(base(), "landing", 5);
    p = placeSfx(p, "ollie-pop", 2, 9);
    expect(p.sfx.map((s) => s.soundId)).toEqual(["ollie-pop", "landing"]);
    expect(p.sfx[0].gain).toBe(2);
    p = moveSfx(p, p.sfx[0].id, 50);
    expect(p.sfx[1].outAtSec).toBe(10);
    p = removeSfx(p, p.sfx[0].id);
    expect(p.sfx).toHaveLength(1);
    let full = base();
    for (let i = 0; i < MAX_SFX + 3; i++) full = placeSfx(full, "flick", i * 0.1);
    expect(full.sfx).toHaveLength(MAX_SFX);
  });
});

describe("export plan", () => {
  it("caps web at 1080p and allows native 4K/60", () => {
    expect(allowedResolutions(WEB_CAPABILITIES)).toEqual(["720p", "1080p"]);
    const p = { ...base(), export: { resolution: "4k" as const, fps: 60 as const } };
    expect(planExport(p, WEB_CAPABILITIES).width).toBe(1920);
    const n = planExport(p, NATIVE_CAPABILITIES);
    expect(n).toMatchObject({ width: 3840, height: 2160, fps: 60, bitrate: bitrateFor("4k", 60) });
    expect(n.exceedsUploadCap).toBe(true);
    expect(n.uploadBitrate).toBeLessThan(n.bitrate);
  });

  it("drops to 30fps when the device can't do 60 and fits short clips", () => {
    const p = setTrim({ ...base(), export: { resolution: "720p" as const, fps: 60 as const } }, 0, 3);
    const plan = planExport(p, { ...WEB_CAPABILITIES, max60fps: false });
    expect(plan.fps).toBe(30);
    expect(plan.exceedsUploadCap).toBe(false);
    expect(bitrateFor("720p", 30)).toBe(6_000_000);
  });
});

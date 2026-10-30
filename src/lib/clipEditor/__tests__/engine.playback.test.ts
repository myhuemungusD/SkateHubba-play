/**
 * EditorEngine behavior beyond seek: GL setup failures, source wiring, frame
 * upload and overlay caching, Web Audio scheduling, the play/pause loop and the
 * real-time web export. WebGL, Web Audio and MediaRecorder do not exist in
 * jsdom, so each is a small recording fake; assertions are on what the engine
 * asks those APIs to do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorEngine } from "../engine";
import { createProject } from "../project";
import type { EditProject } from "../types";

type Call = { name: string; args: unknown[] };

interface GlOpts {
  createShader?: () => unknown;
  createProgram?: () => unknown;
  compileOk?: boolean;
  infoLog?: string | null;
}

function recordingGl(opts: GlOpts = {}) {
  const calls: Call[] = [];
  const overrides: Record<string, (...a: unknown[]) => unknown> = {
    createShader: opts.createShader ?? (() => ({ kind: "shader" })),
    createProgram: opts.createProgram ?? (() => ({ kind: "program" })),
    getShaderParameter: () => opts.compileOk ?? true,
    getShaderInfoLog: () => (opts.infoLog === undefined ? "bad shader" : opts.infoLog),
    // Uniform locations are their own names so assertions read naturally.
    getUniformLocation: (_p, name) => name,
    createTexture: () => ({ kind: "texture" }),
  };
  const gl = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => {
      if (typeof k !== "string") return undefined;
      if (/^[A-Z_0-9]+$/.test(k)) return k; // GL enums: their own names
      return (...args: unknown[]) => {
        calls.push({ name: k, args });
        return overrides[k] ? overrides[k](...args) : 0;
      };
    },
  });
  const named = (n: string) => calls.filter((c) => c.name === n);
  const uniform = (loc: string) =>
    calls.filter((c) => c.name.startsWith("uniform") && c.args[0] === loc).map((c) => c.args.slice(1));
  return { gl, calls, named, uniform };
}

const angle = (id: string, over: Partial<EditProject["angles"][number]> = {}) => ({
  id,
  label: id.toUpperCase(),
  durationSec: 4,
  offsetSec: 0,
  width: 1920,
  height: 1080,
  fps: 30,
  ...over,
});

function makeCanvas(glOpts?: GlOpts) {
  const rec = recordingGl(glOpts);
  const canvas = {
    width: 640,
    height: 360,
    getContext: vi.fn(() => rec.gl),
    captureStream: vi.fn(() => ({ getVideoTracks: () => ["video-track"] })),
  } as unknown as HTMLCanvasElement;
  return { canvas, ...rec };
}

/** A fake 2d context for the engine's offscreen overlay canvas. */
function fake2d() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
  };
}

class FakeGainParam {
  value = 1;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}
class FakeNode {
  connected: unknown[] = [];
  connect = vi.fn((n: unknown) => {
    this.connected.push(n);
    return n;
  });
  disconnect = vi.fn();
}
class FakeGain extends FakeNode {
  gain = new FakeGainParam();
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 10;
  destination = { kind: "speakers" };
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  elementSources: FakeNode[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  decodeAudioData = vi.fn(async (buf: ArrayBuffer) => ({ duration: new Uint8Array(buf)[0] }));
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createMediaStreamDestination() {
    return { kind: "dest", stream: { getAudioTracks: () => ["audio-track"] } };
  }
  createMediaElementSource() {
    const n = new FakeNode();
    this.elementSources.push(n);
    return n;
  }
}

/** Gives a jsdom <video> a controllable clock: setting currentTime fires `seeked`. */
function controlVideo(v: HTMLVideoElement, readyState = 4) {
  let t = 0;
  Object.defineProperty(v, "readyState", { configurable: true, get: () => readyState });
  Object.defineProperty(v, "currentTime", {
    configurable: true,
    get: () => t,
    set: (x: number) => {
      t = x;
      queueMicrotask(() => v.dispatchEvent(new Event("seeked")));
    },
  });
  return {
    advance: (x: number) => {
      t = x;
    },
  };
}

const videosOf = (e: EditorEngine) => (e as unknown as { videos: Map<string, HTMLVideoElement> }).videos;

let ctx2d: ReturnType<typeof fake2d> | null;

beforeEach(() => {
  FakeAudioContext.instances = [];
  ctx2d = fake2d();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx2d as never);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("EditorEngine construction", () => {
  const p = () => createProject(angle("a"));

  it("throws when the GPU cannot allocate a shader", () => {
    const { canvas } = makeCanvas({ createShader: () => null });
    expect(() => new EditorEngine(canvas, p())).toThrow("shader alloc failed");
  });

  it("surfaces the driver's compile log when a shader fails to compile", () => {
    const { canvas } = makeCanvas({ compileOk: false, infoLog: "ERROR: 0:1 syntax" });
    expect(() => new EditorEngine(canvas, p())).toThrow("ERROR: 0:1 syntax");
  });

  it("falls back to a generic message when the driver gives no compile log", () => {
    const { canvas } = makeCanvas({ compileOk: false, infoLog: null });
    expect(() => new EditorEngine(canvas, p())).toThrow("shader compile failed");
  });

  it("throws when the GPU cannot allocate a program", () => {
    const { canvas } = makeCanvas({ createProgram: () => null });
    expect(() => new EditorEngine(canvas, p())).toThrow("program alloc failed");
  });

  it("links one program and binds the video and overlay samplers to units 0 and 1", () => {
    const { canvas, named, uniform } = makeCanvas();
    new EditorEngine(canvas, p());
    expect(named("compileShader")).toHaveLength(2);
    expect(named("linkProgram")).toHaveLength(1);
    expect(named("createTexture")).toHaveLength(2);
    expect(uniform("u_video")).toEqual([[0]]);
    expect(uniform("u_overlay")).toEqual([[1]]);
  });
});

describe("EditorEngine.setSources", () => {
  it("creates one muted, inline, CORS video per angle and keeps angle 0's audio", () => {
    const p = createProject(angle("a"));
    p.angles.push(angle("b"));
    const { canvas } = makeCanvas();
    const e = new EditorEngine(canvas, p);
    e.setSources({ a: "blob:a", b: "blob:b" });
    const [a, b] = [videosOf(e).get("a")!, videosOf(e).get("b")!];
    expect(a.src).toBe("blob:a");
    expect(a.muted).toBe(false);
    expect(b.muted).toBe(true);
    for (const v of [a, b]) {
      expect(v.playsInline).toBe(true);
      expect(v.preload).toBe("auto");
      expect(v.crossOrigin).toBe("anonymous");
    }
  });

  it("does not replace a video that is already attached", () => {
    const { canvas } = makeCanvas();
    const e = new EditorEngine(canvas, createProject(angle("a")));
    e.setSources({ a: "blob:first" });
    const first = videosOf(e).get("a");
    e.setSources({ a: "blob:second" });
    expect(videosOf(e).get("a")).toBe(first);
    expect(first!.src).toBe("blob:first");
  });
});

describe("EditorEngine.draw", () => {
  it("uploads the decoded frame only once the video has data", () => {
    const { canvas, named } = makeCanvas();
    const e = new EditorEngine(canvas, createProject(angle("a")));
    e.setSources({ a: "blob:a" });
    controlVideo(videosOf(e).get("a")!, 1);
    e.draw(0);
    const frameUploads = () => named("texImage2D").filter((c) => c.args[2] === "RGB");
    expect(frameUploads()).toHaveLength(0);
    controlVideo(videosOf(e).get("a")!, 2);
    e.draw(0);
    expect(frameUploads()).toHaveLength(1);
    expect(frameUploads()[0].args[5]).toBe(videosOf(e).get("a"));
  });

  it("draws the angle the cut list selects, falling back to angle 0 when it has no video", () => {
    const p = createProject(angle("a"));
    p.angles.push(angle("b"), angle("c"));
    p.cuts = [
      { atSec: 1, angleId: "b" },
      { atSec: 2, angleId: "c" },
    ];
    const { canvas, named } = makeCanvas();
    const e = new EditorEngine(canvas, p);
    e.setSources({ a: "blob:a", b: "blob:b" }); // no video for c
    for (const id of ["a", "b"]) controlVideo(videosOf(e).get(id)!);
    const uploaded = () =>
      named("texImage2D")
        .filter((c) => c.args[2] === "RGB")
        .at(-1)!.args[5];
    e.draw(1.5);
    expect(uploaded()).toBe(videosOf(e).get("b"));
    e.draw(2.5);
    expect(uploaded()).toBe(videosOf(e).get("a"));
  });

  it("sets size-dependent uniforms from the canvas and scales chroma shift to 1080p", () => {
    const p = createProject(angle("a"));
    p.look = "vhs";
    const { canvas, uniform } = makeCanvas();
    const e = new EditorEngine(canvas, p);
    e.draw(1.25);
    expect(uniform("u_texel")).toEqual([[1 / 640, 1 / 360]]);
    expect(uniform("u_size")).toEqual([[640, 360]]);
    expect(uniform("u_time")).toEqual([[1.25]]);
    // vhs chromaShift is 3 at 1080 lines; 360 lines is a third of that.
    expect(uniform("u_chroma")[0][0]).toBeCloseTo(1);
  });

  it("uses angle 0's clock when called without a time, and 0 before any source exists", () => {
    const { canvas, uniform } = makeCanvas();
    const e = new EditorEngine(canvas, createProject(angle("a")));
    e.draw();
    expect(uniform("u_time").at(-1)).toEqual([0]);
    e.setSources({ a: "blob:a" });
    const clock = controlVideo(videosOf(e).get("a")!);
    clock.advance(1.5);
    e.draw();
    expect(uniform("u_time").at(-1)).toEqual([1.5]);
  });

  it("renders captions into the overlay texture and only re-uploads when they change", () => {
    const p = createProject(angle("a"));
    p.overlays = [{ id: "o1", text: "Kickflip", outStartSec: 0, outEndSec: 2, style: "stamp" }];
    const { canvas, named, uniform } = makeCanvas();
    const e = new EditorEngine(canvas, p);
    const overlayUploads = () => named("texImage2D").filter((c) => c.args[2] === "RGBA");

    e.draw(1);
    expect(ctx2d!.fillText).toHaveBeenCalledWith("KICKFLIP", 320, expect.any(Number));
    expect(overlayUploads()).toHaveLength(1);
    expect(uniform("u_hasOverlay").at(-1)).toEqual([1]);

    e.draw(1.5); // same caption: cached
    expect(overlayUploads()).toHaveLength(1);
    expect(uniform("u_hasOverlay").at(-1)).toEqual([1]);

    e.draw(3); // caption gone: cleared and re-uploaded empty
    expect(overlayUploads()).toHaveLength(2);
    expect(ctx2d!.clearRect).toHaveBeenCalledTimes(2);
    expect(uniform("u_hasOverlay").at(-1)).toEqual([0]);
  });

  it("burns the camcorder stamp in for tape looks even with no captions", () => {
    const p = createProject(angle("a"));
    p.look = "hi8";
    const { canvas, uniform } = makeCanvas();
    new EditorEngine(canvas, p).draw(0);
    expect(ctx2d!.fillText).toHaveBeenCalledWith("PLAY \u25B6", expect.any(Number), expect.any(Number));
    expect(uniform("u_hasOverlay")).toEqual([[1]]);
  });

  it("reports no overlay when the 2d context is unavailable", () => {
    ctx2d = null;
    const p = createProject(angle("a"));
    p.overlays = [{ id: "o1", text: "Tre", outStartSec: 0, outEndSec: 2, style: "minimal" }];
    const { canvas, named, uniform } = makeCanvas();
    new EditorEngine(canvas, p).draw(1);
    expect(uniform("u_hasOverlay")).toEqual([[0]]);
    expect(named("texImage2D").filter((c) => c.args[2] === "RGBA")).toHaveLength(0);
  });
});

describe("EditorEngine.setProject", () => {
  it("redraws a paused preview with the new project but not a playing one", () => {
    const { canvas } = makeCanvas();
    const e = new EditorEngine(canvas, createProject(angle("a")));
    const draw = vi.spyOn(e, "draw").mockImplementation(() => {});
    const next = { ...createProject(angle("a")), look: "vx1000" as const };
    e.setProject(next);
    expect(draw).toHaveBeenCalledTimes(1);
    (e as unknown as { playing: boolean }).playing = true;
    e.setProject(next);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

describe("EditorEngine.loadAudio", () => {
  it("fetches and decodes each URL once, sharing one AudioContext", async () => {
    const fetchMock = vi.fn(async (u: string) => ({
      arrayBuffer: async () => new Uint8Array([u.length]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { canvas } = makeCanvas();
    const e = new EditorEngine(canvas, createProject(angle("a")));
    await e.loadAudio(["/a.m4a", "/bb.m4a"]);
    await e.loadAudio(["/a.m4a", "/ccc.m4a"]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/a.m4a", "/bb.m4a", "/ccc.m4a"]);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].decodeAudioData).toHaveBeenCalledTimes(3);
  });
});

describe("EditorEngine.seek", () => {
  it("skips a seek the video is already at and clamps later angles to their own clip", async () => {
    const p = createProject(angle("a"));
    p.angles.push(angle("b", { offsetSec: 1, durationSec: 1 }));
    const { canvas } = makeCanvas();
    const onTime = vi.fn();
    const e = new EditorEngine(canvas, p, onTime);
    e.setSources({ a: "blob:a", b: "blob:b" });
    controlVideo(videosOf(e).get("a")!);
    controlVideo(videosOf(e).get("b")!);
    const add = vi.spyOn(videosOf(e).get("a")!, "addEventListener");
    await e.seek(0);
    expect(add).not.toHaveBeenCalled(); // a was already at 0
    await e.seek(3);
    expect(videosOf(e).get("a")!.currentTime).toBe(3);
    expect(videosOf(e).get("b")!.currentTime).toBe(1); // 3 - offset 1, capped at its 1 s length
    expect(onTime).toHaveBeenLastCalledWith(3);
  });
});

/** Engine with angle "a" attached, audio buffers pre-loaded, and a manual frame clock. */
function playableEngine(p: EditProject, opts: { rvfc?: boolean; audio?: boolean } = {}) {
  const { canvas } = makeCanvas();
  const onTime = vi.fn();
  const e = new EditorEngine(canvas, p, onTime);
  e.setSources(Object.fromEntries(p.angles.map((a) => [a.id, `blob:${a.id}`])));
  const clocks = new Map(p.angles.map((a) => [a.id, controlVideo(videosOf(e).get(a.id)!)]));
  const main = videosOf(e).get(p.angles[0].id)!;
  const frames: Array<() => void> = [];
  if (opts.rvfc !== false) {
    (main as unknown as { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback = (cb) =>
      frames.push(cb);
  } else {
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  }
  const cancel = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancel);
  let audio: FakeAudioContext | null = null;
  if (opts.audio) {
    audio = new FakeAudioContext();
    (e as unknown as { audio: FakeAudioContext }).audio = audio;
  }
  const buffers = (e as unknown as { buffers: Map<string, { duration: number }> }).buffers;
  const frame = (t: number) => {
    clocks.get(p.angles[0].id)!.advance(t);
    frames.shift()!();
  };
  return { e, main, frames, frame, onTime, cancel, audio, buffers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("EditorEngine.play", () => {
  it("returns at once when angle 0 has no video", async () => {
    const { canvas } = makeCanvas();
    const e = new EditorEngine(canvas, createProject(angle("a")));
    await expect(e.play()).resolves.toBeUndefined();
    expect(e.isPlaying).toBe(false);
  });

  it("follows the speed ramp on every angle frame by frame and stops at the trim out", async () => {
    const p = createProject(angle("a"));
    p.angles.push(angle("b"));
    p.speed = [
      { atSec: 0, speed: 1 },
      { atSec: 1, speed: 0.5 },
    ];
    p.trimOutSec = 2;
    const { e, main, frames, frame, onTime } = playableEngine(p);
    const b = videosOf(e).get("b")!;
    const done = e.play();
    await flush();
    expect(e.isPlaying).toBe(true);
    expect(frames).toHaveLength(1); // first tick queued the next frame
    frame(1.5);
    expect(main.playbackRate).toBe(0.5);
    expect(b.playbackRate).toBe(0.5);
    expect(onTime).toHaveBeenLastCalledWith(2); // 1 s at 1x + 0.5 s at 0.5x
    frame(2);
    await done;
    expect(e.isPlaying).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("falls back to requestAnimationFrame without requestVideoFrameCallback", async () => {
    const { e, frames, frame } = playableEngine(createProject(angle("a")), { rvfc: false });
    const done = e.play();
    await flush();
    expect(frames).toHaveLength(1);
    frame(4);
    await done;
    expect(e.isPlaying).toBe(false);
  });

  it("finishes on the ended event when the last frame callback never comes", async () => {
    const { e, main } = playableEngine(createProject(angle("a")));
    const done = e.play();
    await flush();
    main.dispatchEvent(new Event("ended"));
    await done;
    expect(e.isPlaying).toBe(false);
  });

  it("resolves when paused mid-playback and cancels the pending frame", async () => {
    const { e, main, frame, cancel } = playableEngine(createProject(angle("a")));
    const done = e.play();
    await flush();
    e.pause();
    expect(cancel).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    frame(0.5); // the queued tick sees playing=false and closes out
    await done;
    expect(main.playbackRate).toBe(1);
  });

  it("keeps going when a video refuses to play", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error("NotAllowedError"));
    const { e, frames } = playableEngine(createProject(angle("a")));
    void e.play();
    await flush();
    expect(e.isPlaying).toBe(true);
    expect(frames).toHaveLength(1);
    e.pause();
  });

  it("schedules looping music from the play head and ducks the original audio", async () => {
    const p = createProject(angle("a"));
    p.music = { trackId: "boom-bap-90", trackOffsetSec: 3, gain: 0.7, originalGain: 1.5 };
    const { e, main, audio, buffers } = playableEngine(p, { audio: true });
    buffers.set("/editor/music/boom-bap-90.m4a", { duration: 4 });
    void e.play(2);
    await flush();
    expect(audio!.resume).toHaveBeenCalled();
    expect(main.volume).toBe(1); // clamped to 0..1
    const [music] = audio!.sources;
    expect(music.loop).toBe(true);
    expect(music.connect).toHaveBeenCalledWith(audio!.gains[0]);
    expect(audio!.gains[0].gain.value).toBe(0.7);
    expect(audio!.gains[0].connected).toEqual([audio!.destination]);
    // starts 50 ms ahead, (3 + 2) % 4 = 1 s into the loop, for the 2 s left.
    expect(music.start).toHaveBeenCalledWith(10.05, 1, 2);
    e.pause();
    expect(music.stop).toHaveBeenCalled();
  });

  it("skips music whose buffer is not loaded and plays the original at full volume without music", async () => {
    const p = createProject(angle("a"));
    p.music = { trackId: "boom-bap-90", trackOffsetSec: 0, gain: 1, originalGain: 0.2 };
    const run = playableEngine(p, { audio: true });
    void run.e.play();
    await flush();
    expect(run.audio!.sources).toHaveLength(0);
    expect(run.main.volume).toBeCloseTo(0.2);
    run.e.pause();

    const bare = playableEngine(createProject(angle("a")), { audio: true });
    bare.main.volume = 0.3;
    void bare.e.play();
    await flush();
    expect(bare.main.volume).toBe(1);
    bare.e.pause();
  });

  it("schedules each loaded sound effect with click-free fades and skips the rest", async () => {
    const p = createProject(angle("a"));
    p.sfx = [
      { id: "s1", soundId: "landing", outAtSec: 2, gain: 0.8 }, // ahead of the play head
      { id: "s2", soundId: "grind-5050", outAtSec: 0.5, gain: 1 }, // already under way
      { id: "s3", soundId: "ollie-pop", outAtSec: 0, gain: 1 }, // finished before 1 s
      { id: "s4", soundId: "flick", outAtSec: 3, gain: 1 }, // buffer not loaded
      { id: "s5", soundId: "no-such-sound", outAtSec: 3, gain: 1 }, // unknown id
    ];
    const { e, audio, buffers } = playableEngine(p, { audio: true });
    buffers.set("/editor/sfx/landing.m4a", { duration: 0.9 });
    buffers.set("/editor/sfx/grind-5050.m4a", { duration: 1.7 });
    buffers.set("/editor/sfx/ollie-pop.m4a", { duration: 0.3 });
    void e.play(1);
    await flush();
    expect(audio!.sources).toHaveLength(2);
    const [landing, grind] = audio!.sources;
    const [gLanding, gGrind] = audio!.gains;

    // Landing: 1 s in the future, fades in from silence.
    expect(landing.start).toHaveBeenCalledWith(11.05, 0, 0.9);
    expect(gLanding.gain.setValueAtTime).toHaveBeenNthCalledWith(1, 0, 11.05);
    expect(gLanding.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(1, 0.8, expect.any(Number));
    expect(gLanding.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(11.95));

    // Grind: started 0.5 s ago, so it joins mid-sound at full gain with no fade-in.
    expect(grind.start).toHaveBeenCalledWith(10.05, 0.5, expect.closeTo(1.2));
    expect(gGrind.gain.setValueAtTime).toHaveBeenNthCalledWith(1, 1, 10.05);
    expect(gGrind.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
    e.pause();
  });

  it("ignores a scheduled node that already stopped", async () => {
    const p = createProject(angle("a"));
    p.sfx = [{ id: "s1", soundId: "landing", outAtSec: 0, gain: 1 }];
    const { e, audio, buffers } = playableEngine(p, { audio: true });
    buffers.set("/editor/sfx/landing.m4a", { duration: 0.9 });
    void e.play();
    await flush();
    audio!.sources[0].stop.mockImplementation(() => {
      throw new DOMException("already stopped", "InvalidStateError");
    });
    expect(() => e.pause()).not.toThrow();
    e.pause(); // list was cleared: nothing left to stop
    expect(audio!.sources[0].stop).toHaveBeenCalledTimes(1);
  });
});

describe("EditorEngine audio scheduling guard", () => {
  it("schedules nothing when no AudioContext exists yet", () => {
    // play() only schedules audio once a context exists; the private guard
    // keeps a direct call from touching a missing context.
    const { canvas } = makeCanvas();
    const p = createProject(angle("a"));
    p.sfx = [{ id: "s1", soundId: "landing", outAtSec: 0, gain: 1 }];
    const e = new EditorEngine(canvas, p);
    const start = (e as unknown as { startAudio: (from: number, t: AudioNode) => void }).startAudio.bind(e);
    expect(() => start(0, {} as AudioNode)).not.toThrow();
    expect((e as unknown as { scheduled: unknown[] }).scheduled).toEqual([]);
  });
});

describe("EditorEngine.exportWeb", () => {
  class FakeRecorder {
    static last: FakeRecorder;
    static isTypeSupported = (m: string) => m === "video/webm;codecs=vp9,opus";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn(() => {
      this.ondataavailable?.({ data: new Blob(["frame"]) });
      this.ondataavailable?.({ data: new Blob([]) }); // empty chunks are dropped
      this.onstop?.();
    });
    constructor(
      public stream: { tracks: unknown[] },
      public opts: Record<string, unknown>,
    ) {
      FakeRecorder.last = this;
    }
  }

  beforeEach(() => {
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal(
      "MediaStream",
      class {
        constructor(public tracks: unknown[]) {}
      },
    );
  });

  it("records at the plan size and bitrate, reports progress, then restores the canvas", async () => {
    const p = createProject(angle("a"));
    p.trimOutSec = 2;
    const { e, frame, onTime } = playableEngine(p);
    const progress = vi.fn();
    const blobP = e.exportWeb({ width: 1920, height: 1080, fps: 30, bitrate: 12_000_000 }, progress);
    await flush();
    expect(e.canvas.width).toBe(1920);
    expect(e.canvas.captureStream).toHaveBeenCalledWith(30);
    expect(FakeRecorder.last.stream.tracks).toEqual(["video-track", "audio-track"]);
    expect(FakeRecorder.last.opts).toEqual({
      mimeType: "video/webm;codecs=vp9,opus",
      videoBitsPerSecond: 12_000_000,
      audioBitsPerSecond: 192_000,
    });
    expect(FakeRecorder.last.start).toHaveBeenCalledWith(250);
    frame(1);
    expect(progress).toHaveBeenLastCalledWith(0.5);
    frame(2);
    const blob = await blobP;
    expect(progress).toHaveBeenLastCalledWith(1);
    expect(onTime).toHaveBeenCalledWith(1); // the caller's listener still hears time
    expect(blob.type).toBe("video/webm");
    expect(blob.size).toBe(5);
    expect([e.canvas.width, e.canvas.height]).toEqual([640, 360]);
  });

  it("taps angle 0's audio once across exports and keeps it on the speakers", async () => {
    const p = createProject(angle("a"));
    p.trimOutSec = 0; // zero-length edit: progress is complete at once
    const { e } = playableEngine(p);
    const progress = vi.fn();
    await e.exportWeb({ width: 2, height: 2, fps: 30, bitrate: 1 }, progress);
    await e.exportWeb({ width: 2, height: 2, fps: 30, bitrate: 1 });
    const audio = FakeAudioContext.instances[0];
    expect(audio.elementSources).toHaveLength(1);
    const src = audio.elementSources[0];
    expect(src.connected[0]).toBe(audio.destination);
    expect(src.connect).toHaveBeenCalledTimes(3); // speakers + one export destination each time
    expect(src.disconnect).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(1);
  });

  it("still exports (silent) when there is no angle 0 video", async () => {
    const { canvas } = makeCanvas();
    const e = new EditorEngine(canvas, createProject(angle("a")));
    const blob = await e.exportWeb({ width: 2, height: 2, fps: 30, bitrate: 1 });
    expect(FakeAudioContext.instances[0].elementSources).toHaveLength(0);
    expect(blob.type).toBe("video/webm");
  });
});

describe("EditorEngine.destroy", () => {
  it("stops playback, releases every video and closes audio", async () => {
    const { e, audio } = playableEngine(createProject(angle("a")), { audio: true });
    const v = videosOf(e).get("a")!;
    e.destroy();
    expect(v.hasAttribute("src")).toBe(false);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(videosOf(e).size).toBe(0);
    expect(audio!.close).toHaveBeenCalled();
  });

  it("is safe before any audio was created", () => {
    const { canvas } = makeCanvas();
    expect(() => new EditorEngine(canvas, createProject(angle("a"))).destroy()).not.toThrow();
  });
});

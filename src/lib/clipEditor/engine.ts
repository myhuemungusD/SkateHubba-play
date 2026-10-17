/**
 * Web preview + export engine for the clip editor.
 *
 * Playback: one hidden <video> per angle, kept in sync; the active angle is
 * uploaded as a WebGL texture each decoded frame (requestVideoFrameCallback
 * where available, so we never draw a frame twice or skip one — the preview
 * cannot lag behind the decoder). Speed ramps use playbackRate (browsers
 * keep audio pitch). Music + SFX play through Web Audio, scheduled on the
 * output clock.
 *
 * Export: the same render loop runs into canvas.captureStream + a Web Audio
 * MediaStreamDestination, recorded with MediaRecorder at the planned bitrate.
 * This is real time and capped at 1080p; on iOS the native renderer
 * (services/clipEditorNative.ts) does 4K/60 faster than real time.
 */
import type { EditProject } from "./types";
import { lookParams, COLOR_PRESETS } from "./looks";
import { VERTEX_SRC, FRAGMENT_SRC, colorMatrixUniforms, pillarFor } from "./shader";
import { angleAt } from "./project";
import { outputToSource, sourceToOutput, outputDuration, speedAt } from "./speed";
import { overlaysAt } from "./overlays";
import { getSound } from "./sfxLibrary";
import { getTrack } from "./musicLibrary";

type Uniforms = Record<string, WebGLUniformLocation | null>;
const UNIFORMS = [
  "u_video",
  "u_overlay",
  "u_texel",
  "u_barrel",
  "u_vignette",
  "u_grain",
  "u_chroma",
  "u_scan",
  "u_blur",
  "u_pillar",
  "u_time",
  "u_hasOverlay",
  "u_cm",
  "u_cb",
  "u_size",
];

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader alloc failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh) ?? "shader compile failed");
  return sh;
}

export interface EngineSources {
  /** Object URL (or webview URL) per angle id. */
  [angleId: string]: string;
}

export class EditorEngine {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private uniforms: Uniforms = {};
  private videoTex: WebGLTexture | null;
  private overlayTex: WebGLTexture | null;
  private overlayCanvas: HTMLCanvasElement;
  private overlayKey = "";
  private videos = new Map<string, HTMLVideoElement>();
  private project: EditProject;
  private raf = 0;
  private playing = false;
  private audio: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private scheduled: AudioScheduledSourceNode[] = [];
  private dest: MediaStreamAudioDestinationNode | null = null;
  private mainSource: MediaElementAudioSourceNode | null = null;
  private onTime: (outSec: number) => void;

  constructor(canvas: HTMLCanvasElement, project: EditProject, onTime: (outSec: number) => void = () => {}) {
    this.canvas = canvas;
    this.project = project;
    this.onTime = onTime;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error("program alloc failed");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const u of UNIFORMS) this.uniforms[u] = gl.getUniformLocation(prog, u);
    this.videoTex = this.makeTex(0);
    this.overlayTex = this.makeTex(1);
    gl.uniform1i(this.uniforms.u_video, 0);
    gl.uniform1i(this.uniforms.u_overlay, 1);
    this.overlayCanvas = document.createElement("canvas");
  }

  private makeTex(unit: number): WebGLTexture | null {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /** Attach angle sources. Videos are muted except angle 0's track (mixed in Web Audio). */
  setSources(sources: EngineSources): void {
    for (const [id, url] of Object.entries(sources)) {
      if (this.videos.has(id)) continue;
      const v = document.createElement("video");
      v.src = url;
      v.playsInline = true;
      v.muted = id !== this.project.angles[0].id;
      v.preload = "auto";
      v.crossOrigin = "anonymous";
      this.videos.set(id, v);
    }
  }

  setProject(p: EditProject): void {
    this.project = p;
    if (!this.playing) this.draw();
  }

  async loadAudio(urls: string[]): Promise<void> {
    this.audio ??= new AudioContext();
    const ctx = this.audio;
    await Promise.all(
      urls
        .filter((u) => !this.buffers.has(u))
        .map(async (u) => {
          const res = await fetch(u);
          this.buffers.set(u, await ctx.decodeAudioData(await res.arrayBuffer()));
        }),
    );
  }

  private activeVideo(srcSec: number): HTMLVideoElement | undefined {
    const angle = angleAt(this.project, srcSec);
    return this.videos.get(angle.id) ?? this.videos.get(this.project.angles[0].id);
  }

  private drawOverlay(outSec: number): boolean {
    const items = overlaysAt(this.project, outSec);
    const stamp = lookParams(this.project.look, this.project.lookStrength).timestamp;
    const key =
      items.map((o) => o.id + o.text + o.style).join("|") + `${this.canvas.width}x${this.canvas.height}${stamp}`;
    const has = items.length > 0 || stamp;
    if (key === this.overlayKey) return has;
    this.overlayKey = key;
    const c = this.overlayCanvas;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    ctx.clearRect(0, 0, c.width, c.height);
    items.forEach((o, i) => drawCaption(ctx, o.text, o.style, c.width, c.height, i));
    if (stamp) drawTapeStamp(ctx, c.width, c.height, new Date());
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    return has;
  }

  /** Render the current frame. */
  draw(outSec = this.currentOut()): void {
    const gl = this.gl;
    const src = outputToSource(this.project, outSec);
    const v = this.activeVideo(src);
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    if (v && v.readyState >= 2) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
    }
    const look = lookParams(this.project.look, this.project.lookStrength);
    const { mat, bias } = colorMatrixUniforms(COLOR_PRESETS[this.project.color].matrix);
    const u = this.uniforms;
    gl.uniform2f(u.u_texel, 1 / w, 1 / h);
    gl.uniform2f(u.u_size, w, h);
    gl.uniform1f(u.u_barrel, look.barrel);
    gl.uniform1f(u.u_vignette, look.vignette);
    gl.uniform1f(u.u_grain, look.grain);
    gl.uniform1f(u.u_chroma, (look.chromaShift * h) / 1080);
    gl.uniform1f(u.u_scan, look.scanlines);
    gl.uniform1f(u.u_blur, look.blur);
    gl.uniform1f(u.u_pillar, pillarFor(look, w, h));
    gl.uniform1f(u.u_time, outSec);
    gl.uniform1f(u.u_hasOverlay, this.drawOverlay(outSec) ? 1 : 0);
    gl.uniformMatrix4fv(u.u_cm, false, mat);
    gl.uniform4fv(u.u_cb, bias);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private currentOut(): number {
    const v = this.videos.get(this.project.angles[0].id);
    return v ? sourceToOutput(this.project, v.currentTime) : 0;
  }

  /** Seek every angle to output time `outSec`. */
  async seek(outSec: number): Promise<void> {
    const src = outputToSource(this.project, outSec);
    await Promise.all(
      this.project.angles.map(
        (a) =>
          new Promise<void>((resolve) => {
            const v = this.videos.get(a.id);
            if (!v) return resolve();
            const target = Math.max(0, Math.min(a.durationSec, src - a.offsetSec));
            if (Math.abs(v.currentTime - target) < 0.001) return resolve();
            v.addEventListener("seeked", () => resolve(), { once: true });
            v.currentTime = target;
          }),
      ),
    );
    this.draw(outSec);
    this.onTime(outSec);
  }

  private startAudio(fromOut: number, target: AudioNode): void {
    const ctx = this.audio;
    if (!ctx) return;
    const now = ctx.currentTime + 0.05;
    const p = this.project;
    const dur = outputDuration(p);
    if (p.music) {
      const track = getTrack(p.music.trackId);
      const b = track && this.buffers.get(track.src);
      if (b) {
        const node = ctx.createBufferSource();
        node.buffer = b;
        node.loop = true;
        const g = ctx.createGain();
        g.gain.value = p.music.gain;
        node.connect(g).connect(target);
        node.start(now, (p.music.trackOffsetSec + fromOut) % b.duration, dur - fromOut);
        this.scheduled.push(node);
      }
    }
    for (const s of p.sfx) {
      const sound = getSound(s.soundId);
      const b = sound && this.buffers.get(sound.src);
      if (!b || s.outAtSec + b.duration < fromOut) continue;
      const node = ctx.createBufferSource();
      node.buffer = b;
      const g = ctx.createGain();
      g.gain.value = s.gain;
      node.connect(g).connect(target);
      const delay = s.outAtSec - fromOut;
      node.start(now + Math.max(0, delay), Math.max(0, -delay));
      this.scheduled.push(node);
    }
  }

  private stopAudio(): void {
    for (const n of this.scheduled) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.scheduled = [];
  }

  /** Play from `fromOut` to the end of the edit. Resolves when playback ends or pause() is called. */
  async play(fromOut = 0, audioTarget?: AudioNode): Promise<void> {
    await this.seek(fromOut);
    const p = this.project;
    const main = this.videos.get(p.angles[0].id);
    if (!main) return;
    this.playing = true;
    if (this.audio) {
      await this.audio.resume();
      const originalGain = p.music ? p.music.originalGain : 1;
      main.volume = Math.max(0, Math.min(1, originalGain));
      this.startAudio(fromOut, audioTarget ?? this.audio.destination);
    }
    const vids = p.angles.map((a) => this.videos.get(a.id)).filter((v): v is HTMLVideoElement => !!v);
    await Promise.all(vids.map((v) => v.play().catch(() => undefined)));
    return new Promise((resolve) => {
      // requestVideoFrameCallback never fires again once the element ends, so
      // the ended event is what closes out a trim that runs to the last frame.
      const finish = (): void => {
        main.removeEventListener("ended", finish);
        if (this.playing) this.pause();
        resolve();
      };
      main.addEventListener("ended", finish);
      const tick = (): void => {
        if (!this.playing) return finish();
        const src = main.currentTime;
        const rate = speedAt(this.project.speed, src);
        for (const v of vids) if (v.playbackRate !== rate) v.playbackRate = rate;
        const out = sourceToOutput(this.project, src);
        this.draw(out);
        this.onTime(out);
        if (src >= this.project.trimOutSec - 1 / 240 || main.ended) return finish();
        this.raf =
          typeof main.requestVideoFrameCallback === "function"
            ? main.requestVideoFrameCallback(tick)
            : requestAnimationFrame(tick);
      };
      tick();
    });
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    for (const v of this.videos.values()) v.pause();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Real-time web export. Resizes the canvas to the plan, records, then restores it. */
  async exportWeb(
    plan: { width: number; height: number; fps: number; bitrate: number },
    onProgress?: (p: number) => void,
  ): Promise<Blob> {
    const prev = { w: this.canvas.width, h: this.canvas.height };
    this.canvas.width = plan.width;
    this.canvas.height = plan.height;
    this.audio ??= new AudioContext();
    this.dest = this.audio.createMediaStreamDestination();
    const main = this.videos.get(this.project.angles[0].id);
    if (main) {
      // createMediaElementSource may only be called once per element; keep it
      // and route it to the speakers too so preview audio survives the export.
      if (!this.mainSource) {
        this.mainSource = this.audio.createMediaElementSource(main);
        this.mainSource.connect(this.audio.destination);
      }
      this.mainSource.connect(this.dest);
    }
    const stream = new MediaStream([
      ...this.canvas.captureStream(plan.fps).getVideoTracks(),
      ...this.dest.stream.getAudioTracks(),
    ]);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: plan.bitrate,
      audioBitsPerSecond: 192_000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    const total = outputDuration(this.project);
    const prevOnTime = this.onTime;
    this.onTime = (t) => {
      prevOnTime(t);
      onProgress?.(total > 0 ? Math.min(1, t / total) : 1);
    };
    rec.start(250);
    try {
      await this.play(0, this.dest);
    } finally {
      rec.stop();
      await done;
      this.onTime = prevOnTime;
      this.mainSource?.disconnect(this.dest);
      this.canvas.width = prev.w;
      this.canvas.height = prev.h;
    }
    return new Blob(chunks, { type: mime.split(";")[0] });
  }

  destroy(): void {
    this.pause();
    for (const v of this.videos.values()) {
      v.removeAttribute("src");
      v.load();
    }
    this.videos.clear();
    void this.audio?.close();
  }
}

export function pickMime(): string {
  const options = ["video/mp4;codecs=avc1.640033,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

/** Skate-video caption styles: block "stamp", label-maker "tape", clean "minimal". */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: "stamp" | "tape" | "minimal",
  w: number,
  h: number,
  row: number,
): void {
  const size = Math.round(h * (style === "minimal" ? 0.05 : 0.07));
  const y = h * 0.82 - row * size * 1.6;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (style === "tape") {
    ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
    const label = text.toUpperCase();
    const tw = ctx.measureText(label).width + size;
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillRect(w / 2 - tw / 2, y - size * 0.7, tw, size * 1.4);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, w / 2, y);
    return;
  }
  ctx.font =
    style === "stamp"
      ? `900 italic ${size}px Impact, "Arial Black", sans-serif`
      : `600 ${size}px system-ui, sans-serif`;
  const label = style === "stamp" ? text.toUpperCase() : text;
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(label, w / 2, y);
  ctx.fillStyle = style === "stamp" ? "#FF6B00" : "#fff";
  ctx.fillText(label, w / 2, y);
}

/** Camcorder-style "PLAY ▶" + date burn-in for the VHS/Hi8 looks. */
export function drawTapeStamp(ctx: CanvasRenderingContext2D, w: number, h: number, date: Date): void {
  const size = Math.round(h * 0.045);
  ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = size * 0.2;
  ctx.fillText("PLAY \u25B6", w * 0.05, h * 0.06);
  ctx.textAlign = "right";
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  ctx.fillText(
    `${months[date.getMonth()]}. ${String(date.getDate()).padStart(2, "0")} ${date.getFullYear()}`,
    w * 0.95,
    h * 0.88,
  );
  ctx.shadowBlur = 0;
}

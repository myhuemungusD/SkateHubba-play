#!/usr/bin/env node
/**
 * Generates the clip editor's skate sound effects and beat-sync music loops
 * from scratch (pure synthesis — no samples, no third-party audio). Output is
 * deterministic (seeded PRNG) so re-running produces byte-identical files.
 * Everything written here is an original work released under CC0 1.0; see
 * public/editor/CREDITS.md.
 *
 *   node scripts/generate-skate-sfx.mjs   (needs ffmpeg on PATH for AAC)
 *
 * Files ship as AAC .m4a (plays in WKWebView, Safari, Chrome and AVFoundation).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "editor");

let seed = 0x5ca7e;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};
const noise = () => rand() * 2 - 1;

function wav(samples, rate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  let peak = 1e-9;
  for (const v of samples) {
    if (!Number.isFinite(v)) throw new Error("non-finite sample");
    peak = Math.max(peak, Math.abs(v));
  }
  const g = 0.89 / peak; // normalise to -1 dBFS
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * g)) * 32767), 44 + i * 2);
  return buf;
}

/** RBJ biquad band-pass, constant 0 dB peak. */
function bandpass(x, rate, f, q) {
  const w = (2 * Math.PI * f) / rate;
  const a = Math.sin(w) / (2 * q);
  const b0 = a,
    b2 = -a,
    a0 = 1 + a,
    a1 = -2 * Math.cos(w),
    a2 = 1 - a;
  const y = new Float64Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
function lowpass(x, rate, f) {
  const k = 1 - Math.exp((-2 * Math.PI * f) / rate);
  const y = new Float64Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) y[i] = s += k * (x[i] - s);
  return y;
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const buf = (sec, rate) => new Float64Array(Math.round(sec * rate));
const mix = (dst, src, at, rate, gain = 1) => {
  const o = Math.round(at * rate);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
  return dst;
};

const R = 22050;

function knock(sec, f, decay, bright = 0.5) {
  const n = buf(sec, R);
  const nz = n.map(() => noise());
  const body = bandpass(nz, R, f * 6, 2);
  for (let i = 0; i < n.length; i++) {
    const t = i / R;
    n[i] =
      Math.sin(2 * Math.PI * f * t * (1 + 0.3 * Math.exp(-t / 0.01))) * env(t, 0.0008, decay) +
      body[i] * bright * env(t, 0.0005, decay / 3);
  }
  return n;
}

function scrape(sec, { centre, q, rough, partials = [], wobble = 0, attack = 0.03, release = 0.25 }) {
  const n = buf(sec, R);
  const nz = n.map(() => noise());
  const band = bandpass(nz, R, centre, q);
  const grit = lowpass(
    nz.map(() => noise()),
    R,
    30,
  );
  for (let i = 0; i < n.length; i++) {
    const t = i / R;
    const a = Math.min(t / attack, 1) * Math.min((sec - t) / release, 1);
    let ring = 0;
    for (const [f, g] of partials)
      ring += Math.sin(2 * Math.PI * f * t * (1 + wobble * Math.sin(2 * Math.PI * 5 * t))) * g;
    n[i] = a * (band[i] * (1 + rough * grit[i] * 8) + ring * (0.6 + 0.4 * grit[i] * 6));
  }
  return n;
}

const SFX = {
  "ollie-pop": () => {
    const out = buf(0.35, R);
    mix(out, knock(0.3, 190, 0.05, 0.9), 0, R);
    mix(out, knock(0.2, 420, 0.02, 0.4), 0.004, R, 0.5);
    return out;
  },
  flick: () => {
    const out = scrape(0.25, { centre: 3200, q: 1.2, rough: 0.8, attack: 0.01, release: 0.15 });
    return mix(out, knock(0.1, 600, 0.015, 0.3), 0.18, R, 0.3);
  },
  landing: () => {
    const out = buf(0.6, R);
    mix(out, knock(0.6, 70, 0.12, 0.6), 0, R);
    mix(out, knock(0.4, 150, 0.06, 0.8), 0.006, R, 0.7);
    for (let k = 0; k < 5; k++) mix(out, knock(0.08, 900 + rand() * 600, 0.01, 0.2), 0.03 + k * 0.025, R, 0.12);
    return out;
  },
  "grind-5050": () =>
    scrape(1.5, {
      centre: 1800,
      q: 1.5,
      rough: 0.6,
      partials: [
        [1240, 0.2],
        [2710, 0.12],
      ],
      wobble: 0.004,
    }),
  "grind-crooked": () =>
    scrape(1.5, {
      centre: 2400,
      q: 2.2,
      rough: 0.9,
      partials: [
        [1530, 0.25],
        [3390, 0.1],
      ],
      wobble: 0.01,
    }),
  "grind-smith": () =>
    scrape(1.5, {
      centre: 1400,
      q: 1.1,
      rough: 1.1,
      partials: [
        [980, 0.18],
        [2300, 0.14],
      ],
      wobble: 0.006,
    }),
  "slide-wood": () => scrape(1.2, { centre: 700, q: 0.9, rough: 0.7 }),
  "slide-concrete": () => scrape(1.2, { centre: 2600, q: 0.5, rough: 1.4 }),
  "slide-metal": () =>
    scrape(1.2, {
      centre: 3600,
      q: 3,
      rough: 0.4,
      partials: [
        [2950, 0.35],
        [4410, 0.2],
      ],
      wobble: 0.003,
    }),
  "wheel-roll": () => {
    const out = scrape(3, { centre: 160, q: 0.7, rough: 0.5, attack: 0.3, release: 0.5 });
    for (let t = 0.4; t < 2.6; t += 0.55 + rand() * 0.2) mix(out, knock(0.08, 110, 0.02, 0.5), t, R, 0.5);
    return out;
  },
  powerslide: () => {
    const out = scrape(1, { centre: 1100, q: 1.4, rough: 1.2, attack: 0.05, release: 0.3 });
    const sq = buf(1, R);
    for (let i = 0; i < sq.length; i++) {
      const t = i / R;
      sq[i] = Math.sin(2 * Math.PI * (1700 + 300 * Math.sin(Math.PI * t)) * t) * 0.15 * Math.sin(Math.PI * t);
    }
    return mix(out, sq, 0, R);
  },
  bail: () => {
    const out = buf(0.9, R);
    const hits = [
      [0, 140, 0.9],
      [0.09, 260, 0.6],
      [0.21, 180, 0.7],
      [0.36, 320, 0.4],
      [0.52, 220, 0.3],
      [0.66, 400, 0.2],
    ];
    for (const [t, f, g] of hits) mix(out, knock(0.25, f, 0.05, 0.8), t, R, g);
    return out;
  },
  "crowd-hype": () => {
    const sec = 2.5;
    const out = buf(sec, R);
    for (let v = 0; v < 18; v++) {
      const f = 300 + rand() * 900;
      const voice = bandpass(
        buf(sec, R).map(() => noise()),
        R,
        f,
        6,
      );
      const start = rand() * 0.3;
      for (let i = 0; i < voice.length; i++) {
        const t = i / R;
        voice[i] *=
          Math.max(0, Math.min((t - start) / 0.2, 1)) *
          Math.min((sec - t) / 0.6, 1) *
          (0.7 + 0.3 * Math.sin(2 * Math.PI * (2 + rand() * 0.01) * t + v));
      }
      mix(out, voice, 0, R, 1);
    }
    const whistle = buf(0.6, R);
    for (let i = 0; i < whistle.length; i++) {
      const t = i / R;
      whistle[i] = Math.sin(2 * Math.PI * (2200 + 500 * t) * t) * Math.sin((Math.PI * t) / 0.6) * 0.5;
    }
    return mix(out, whistle, 0.5, R, 0.4);
  },
};

const MR = 16000;
function drumLoop(bpm, style) {
  const beat = 60 / bpm;
  const bars = 8;
  const out = buf(bars * 4 * beat, MR);
  const kick = (() => {
    const k = buf(0.4, MR);
    for (let i = 0; i < k.length; i++) {
      const t = i / MR;
      k[i] = Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-t / 0.03)) * t) * env(t, 0.002, 0.12);
    }
    return k;
  })();
  const snare = (() => {
    const s = buf(0.3, MR);
    const nz = bandpass(
      s.map(() => noise()),
      MR,
      2500,
      0.7,
    );
    for (let i = 0; i < s.length; i++) {
      const t = i / MR;
      s[i] = (nz[i] * 1.4 + Math.sin(2 * Math.PI * 190 * t) * 0.5) * env(t, 0.001, 0.07);
    }
    return s;
  })();
  const hat = (() => {
    const h = buf(0.06, MR);
    const nz = bandpass(
      h.map(() => noise()),
      MR,
      6500,
      1.5,
    );
    for (let i = 0; i < h.length; i++) h[i] = nz[i] * env(i / MR, 0.0005, 0.015);
    return h;
  })();
  const bassNotes = {
    "boom-bap": [55, 55, 65.4, 49],
    punk: [82.4, 82.4, 110, 98],
    lofi: [61.7, 55, 49, 55],
    breaks: [73.4, 73.4, 87.3, 65.4],
  }[style];
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4 * beat;
    const pattern = {
      "boom-bap": { k: [0, 1.5, 2.75], s: [1, 3], h: 0.5 },
      punk: { k: [0, 1, 2, 3], s: [0.5, 1.5, 2.5, 3.5], h: 0.5 },
      lofi: { k: [0, 2.5], s: [1, 3], h: 0.5 },
      breaks: { k: [0, 0.75, 2.5], s: [1, 3, 3.75], h: 0.25 },
    }[style];
    for (const k of pattern.k) mix(out, kick, b0 + k * beat, MR, 1);
    for (const s of pattern.s) mix(out, snare, b0 + s * beat, MR, 0.7);
    for (let h = 0; h < 4; h += pattern.h) mix(out, hat, b0 + h * beat, MR, 0.25);
    const f = bassNotes[bar % 4];
    const bass = buf(4 * beat, MR);
    for (let i = 0; i < bass.length; i++) {
      const t = i / MR;
      const tb = t % beat;
      bass[i] =
        (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * env(tb, 0.005, beat * 0.6) * 0.45;
    }
    mix(out, lowpass(bass, MR, 400), b0, MR, 1);
  }
  return out;
}

const MUSIC = {
  "boom-bap-90": [90, "boom-bap"],
  "punk-170": [170, "punk"],
  "lofi-75": [75, "lofi"],
  "breaks-128": [128, "breaks"],
};

mkdirSync(join(OUT, "sfx"), { recursive: true });
mkdirSync(join(OUT, "music"), { recursive: true });
function writeAac(dir, id, samples, rate, kbps) {
  const tmp = join(OUT, dir, `${id}.wav`);
  writeFileSync(tmp, wav(samples, rate));
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    tmp,
    "-c:a",
    "aac",
    "-b:a",
    `${kbps}k`,
    "-map_metadata",
    "-1",
    "-fflags",
    "+bitexact",
    join(OUT, dir, `${id}.m4a`),
  ]);
  rmSync(tmp);
}
// These slots now hold real recordings (scripts/process-recorded-sfx.sh, CC BY
// SoundBiterSFX). Their synth versions stay defined as fallbacks but are not
// written unless SYNTH_ALL=1.
const RECORDED = new Set(["ollie-pop", "flick", "landing", "grind-5050", "slide-concrete", "powerslide", "wheel-roll"]);
for (const [id, fn] of Object.entries(SFX)) {
  if (RECORDED.has(id) && !process.env.SYNTH_ALL) continue;
  writeAac("sfx", id, fn(), R, 96);
}
for (const [id, [bpm, style]] of Object.entries(MUSIC)) {
  const loop = drumLoop(bpm, style);
  writeAac("music", id, style === "lofi" ? lowpass(loop, MR, 3500) : loop, MR, 64);
}
console.log("wrote", Object.keys(SFX).length, "sfx and", Object.keys(MUSIC).length, "music loops to", OUT);

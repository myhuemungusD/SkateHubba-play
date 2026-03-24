/** Synthesized ollie pop sound using Web Audio API — no audio files needed. */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

export function playOlliePop(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Layer 1: Noise burst (tail hitting ground)
    const noiseLen = 0.08;
    const buf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 800;
    bp.Q.value = 1.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    noise.connect(bp).connect(noiseGain).connect(ctx.destination);

    // Layer 2: High snap (board popping)
    const snap = ctx.createOscillator();
    snap.type = "sine";
    snap.frequency.setValueAtTime(1200, now);
    snap.frequency.exponentialRampToValueAtTime(200, now + 0.05);
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.35, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    snap.connect(snapGain).connect(ctx.destination);

    // Layer 3: Low thud (weight)
    const thud = ctx.createOscillator();
    thud.type = "sine";
    thud.frequency.setValueAtTime(150, now);
    thud.frequency.exponentialRampToValueAtTime(50, now + 0.04);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.25, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    thud.connect(thudGain).connect(ctx.destination);

    noise.start(now);
    snap.start(now);
    thud.start(now + 0.01);
    noise.stop(now + 0.1);
    snap.stop(now + 0.1);
    thud.stop(now + 0.1);
  } catch {
    // Audio not available — silently skip
  }
}

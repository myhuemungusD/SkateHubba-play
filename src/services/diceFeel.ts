/**
 * Roll Dice sound, haptics and motion.
 *
 * Sounds are synthesized (no audio files): a dry concrete "clack" per die,
 * a short rattle for the throw, and the existing app chimes for a match
 * result. Haptics reuse the app vocabulary in haptics.ts and stay quiet on
 * ordinary throws ("less is more"); only landing, big hands, bails and the
 * result buzz. Both respect the app-wide Sound and Haptics toggles.
 *
 * Quick rolls is a dice-only motion setting: dice land at once with no
 * flight, the same thing the OS reduced-motion setting does.
 */
import { isHapticsEnabled, playHaptic } from "./haptics";
import { isSoundEnabled, playChime } from "./sounds";

export type DiceCue = "throw" | "land" | "settle" | "big" | "bail" | "turn" | "win" | "loss";

const QUICK_KEY = "skate_dice_quick_rolls";

export function isQuickRolls(): boolean {
  try {
    return localStorage.getItem(QUICK_KEY) === "1";
  } catch {
    return false;
  }
}

export function setQuickRolls(on: boolean): void {
  try {
    localStorage.setItem(QUICK_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable — keep the default */
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** @internal reset the shared context between tests */
export function __resetDiceAudioForTest(): void {
  ctx = null;
}

/** A short band-passed noise burst over a low thump: a die hitting concrete. */
function clack(ac: AudioContext, delay: number, level: number, pitch: number): void {
  const t = ac.currentTime + delay;
  const length = Math.floor(ac.sampleRate * 0.05);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(pitch, t);
  band.Q.setValueAtTime(1.4, t);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(level, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  noise.connect(band).connect(gain).connect(ac.destination);
  noise.start(t);

  const thump = ac.createOscillator();
  const body = ac.createGain();
  thump.type = "sine";
  thump.frequency.setValueAtTime(150, t);
  thump.frequency.exponentialRampToValueAtTime(70, t + 0.07);
  body.gain.setValueAtTime(level * 0.6, t);
  body.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  thump.connect(body).connect(ac.destination);
  thump.start(t);
  thump.stop(t + 0.09);
}

function sound(cue: DiceCue): void {
  if (!isSoundEnabled()) return;
  if (cue === "win") return playChime("game_won");
  if (cue === "loss") return playChime("game_lost");
  if (cue === "turn") return playChime("your_turn");
  const ac = audio();
  if (!ac) return;
  switch (cue) {
    case "throw":
      clack(ac, 0, 0.08, 3200);
      clack(ac, 0.035, 0.06, 3600);
      return;
    case "land":
      clack(ac, 0, 0.22, 2000 + Math.random() * 500);
      return;
    case "settle":
      clack(ac, 0, 0.12, 1700);
      return;
    case "big":
      clack(ac, 0, 0.28, 1500);
      clack(ac, 0.09, 0.2, 1200);
      return;
    case "bail":
      clack(ac, 0, 0.3, 900);
      return;
  }
}

function haptic(cue: DiceCue): void {
  if (!isHapticsEnabled()) return;
  switch (cue) {
    case "throw":
      return playHaptic("toast");
    case "settle":
      return playHaptic("button_primary");
    case "big":
    case "win":
      return playHaptic("game_won");
    case "bail":
    case "loss":
      return playHaptic("game_lost");
    case "turn":
      return playHaptic("your_turn");
    case "land":
      return;
  }
}

/** Fire-and-forget. Never throws: a missing audio or haptics API is silent. */
export function playDiceCue(cue: DiceCue): void {
  try {
    sound(cue);
  } catch {
    /* audio unavailable */
  }
  haptic(cue);
}

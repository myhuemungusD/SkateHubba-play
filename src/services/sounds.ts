/**
 * Web Audio API chime synthesizer — zero audio files, fully programmatic.
 *
 * Produces short, distinctive tones for different game event types.
 * Sound preference is persisted to localStorage.
 */

export type ChimeType = "your_turn" | "new_challenge" | "game_won" | "game_lost" | "general";

const STORAGE_KEY = "skate_sound_enabled";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  // Resume if suspended (autoplay policy)
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/* ── Preference ────────────────────────────── */

export function isSoundEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* quota exceeded — ignore */
  }
}

/* ── Helpers ───────────────────────────────── */

function ping(frequency: number, duration: number, type: OscillatorType = "sine", gain = 0.18, startTime = 0) {
  const ac = getCtx();
  const t = ac.currentTime + startTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);

  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration);
}

/* ── Chime definitions ─────────────────────── */

function chimeYourTurn() {
  // Bright ascending 2-note (C5 → E5)
  ping(523.25, 0.2, "sine", 0.2, 0);
  ping(659.25, 0.3, "sine", 0.2, 0.12);
}

function chimeNewChallenge() {
  // Bold double-tap (G4, G4)
  ping(392, 0.15, "triangle", 0.22, 0);
  ping(392, 0.2, "triangle", 0.22, 0.18);
}

function chimeGameWon() {
  // Triumphant ascending arpeggio (C5 → E5 → G5)
  ping(523.25, 0.2, "sine", 0.18, 0);
  ping(659.25, 0.2, "sine", 0.18, 0.12);
  ping(783.99, 0.35, "sine", 0.22, 0.24);
}

function chimeGameLost() {
  // Low descending (E4 → C4)
  ping(329.63, 0.2, "sine", 0.14, 0);
  ping(261.63, 0.35, "sine", 0.12, 0.14);
}

function chimeGeneral() {
  // Subtle single ping (A5)
  ping(880, 0.18, "sine", 0.13, 0);
}

const chimeMap: Record<ChimeType, () => void> = {
  your_turn: chimeYourTurn,
  new_challenge: chimeNewChallenge,
  game_won: chimeGameWon,
  game_lost: chimeGameLost,
  general: chimeGeneral,
};

/* ── Public API ────────────────────────────── */

export function playChime(type: ChimeType): void {
  if (!isSoundEnabled()) return;
  try {
    chimeMap[type]();
  } catch {
    /* AudioContext not available — fail silently */
  }
}

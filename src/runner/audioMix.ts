import {
  BASE_SPEED,
  GRIND_GAIN_HI,
  GRIND_GAIN_LO,
  GRIND_RATE_HI,
  GRIND_RATE_LO,
  MAX_SPEED,
  ROLL_GAIN_HI,
  ROLL_GAIN_LO,
  ROLL_RATE_HI,
  ROLL_RATE_LO,
  SCRAPE_GAIN,
  SCRAPE_RATE,
} from "./tune";

export interface MixSnapshot {
  speed: number;
  onGrind: boolean;
  airborne: boolean;
  /** Powerslide clock. Negative means the board is not sliding. */
  duck: number;
  status: string;
}

export interface MixLevels {
  rollGain: number;
  rollRate: number;
  grindGain: number;
  grindRate: number;
}

function unitSpeed(speed: number): number {
  const span = MAX_SPEED - BASE_SPEED;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (speed - BASE_SPEED) / span));
}

function lerp(lo: number, hi: number, t: number): number {
  return lo + (hi - lo) * t;
}

/**
 * Roll under the wheels, grind on a lock, scrape on a powerslide.
 * Pop and land are one-shots and are not in this mix. A paused or finished
 * run returns silence so the loops can fade out.
 */
export function mixLevels(snapshot: MixSnapshot): MixLevels {
  const unit = unitSpeed(snapshot.speed);
  const live = snapshot.status === "playing";
  const rolling = live && !snapshot.airborne && !snapshot.onGrind && snapshot.duck < 0;
  const scraping = live && snapshot.duck >= 0 && !snapshot.onGrind;
  const grinding = live && snapshot.onGrind;
  return {
    rollGain: rolling ? lerp(ROLL_GAIN_LO, ROLL_GAIN_HI, unit) : 0,
    rollRate: lerp(ROLL_RATE_LO, ROLL_RATE_HI, unit),
    grindGain: grinding ? lerp(GRIND_GAIN_LO, GRIND_GAIN_HI, unit) : scraping ? SCRAPE_GAIN : 0,
    grindRate: grinding ? lerp(GRIND_RATE_LO, GRIND_RATE_HI, unit) : SCRAPE_RATE,
  };
}

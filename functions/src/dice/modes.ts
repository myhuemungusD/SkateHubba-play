/**
 * The four Roll Dice games and the match lengths each one allows.
 *
 * A match is a race to a target score. C-Lo, 4-5-6 and Craps score small
 * hand points (1-3 a round), so their targets are small. 10,000 keeps its
 * own natural scoring, so its targets are in the thousands.
 */
export type DiceMode = "clo" | "s456" | "craps" | "ten";

export const DICE_MODES: readonly DiceMode[] = ["clo", "s456", "craps", "ten"];

interface ModeRule {
  /** Dice thrown on a fresh roll. */
  dice: number;
  /** Allowed race-to targets. The first one is the default. */
  targets: readonly number[];
  /** Hands alternate (craps, 10,000) rather than both players rolling each round. */
  alternating: boolean;
  name: string;
}

export const MODE_RULES: Readonly<Record<DiceMode, ModeRule>> = {
  clo: { dice: 3, targets: [5, 9], alternating: false, name: "C-Lo" },
  s456: { dice: 3, targets: [5, 9], alternating: false, name: "4-5-6" },
  craps: { dice: 2, targets: [5, 9], alternating: true, name: "Craps" },
  ten: { dice: 6, targets: [5000, 10000], alternating: true, name: "10,000" },
};

export function isDiceMode(value: unknown): value is DiceMode {
  return typeof value === "string" && (DICE_MODES as readonly string[]).includes(value);
}

export function defaultTarget(mode: DiceMode): number {
  return MODE_RULES[mode].targets[0] ?? 5;
}

export function isAllowedTarget(mode: DiceMode, value: unknown): value is number {
  return typeof value === "number" && MODE_RULES[mode].targets.includes(value);
}

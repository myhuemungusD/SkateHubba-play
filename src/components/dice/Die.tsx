/**
 * One die: a griptape cube with hex-socket bolt heads for pips. The ace is a
 * single orange bolt, after the off-colour "nose bolt" skaters use to mark
 * the front of a board. Face 0 is a blank die (dice in hand, nothing rolled).
 *
 * Motion is CSS only: `land` drops the die in after `order` steps, `rattle`
 * shakes it in hand while the server rolls. Reduced motion fades instead
 * (handled in index.css).
 */

/** Pip cells on a 3×3 face. Row, then column. */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 2],
    [2, 0],
  ],
  3: [
    [0, 2],
    [1, 1],
    [2, 0],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 2],
    [1, 2],
    [2, 2],
  ],
};

export type DieSize = "lg" | "md" | "sm" | "xs";
export type DieMotion = "rest" | "land" | "rattle" | "fade";

const SIZE: Record<DieSize, { box: string; pip: string; ace: string; pad: string }> = {
  lg: { box: "h-[68px] w-[68px] rounded-[16px]", pip: "h-[13px] w-[13px]", ace: "h-[17px] w-[17px]", pad: "p-[9px]" },
  md: { box: "h-[50px] w-[50px] rounded-[12px]", pip: "h-[9px] w-[9px]", ace: "h-[12px] w-[12px]", pad: "p-[7px]" },
  sm: { box: "h-8 w-8 rounded-[8px]", pip: "h-[6px] w-[6px]", ace: "h-[7px] w-[7px]", pad: "p-[4px]" },
  xs: { box: "h-6 w-6 rounded-[6px]", pip: "h-[4px] w-[4px]", ace: "h-[5px] w-[5px]", pad: "p-[3px]" },
};

/** Resting angles, so a row of dice never looks machine-placed. Static strings for Tailwind. */
const TILT = ["[--tilt:-4deg]", "[--tilt:3deg]", "[--tilt:-1deg]", "[--tilt:5deg]", "[--tilt:-3deg]", "[--tilt:2deg]"];
const REST = ["-rotate-[4deg]", "rotate-[3deg]", "-rotate-1", "rotate-[5deg]", "-rotate-[3deg]", "rotate-2"];
const SPIN = [
  "[--spin:-150deg]",
  "[--spin:120deg]",
  "[--spin:-200deg]",
  "[--spin:170deg]",
  "[--spin:-110deg]",
  "[--spin:210deg]",
];
const DELAY = [
  "[animation-delay:0ms]",
  "[animation-delay:110ms]",
  "[animation-delay:220ms]",
  "[animation-delay:330ms]",
  "[animation-delay:440ms]",
  "[animation-delay:550ms]",
];

function Bolt({ ace, size }: { ace: boolean; size: DieSize }) {
  const dims = ace ? SIZE[size].ace : SIZE[size].pip;
  const metal = ace
    ? "bg-[radial-gradient(circle_at_35%_30%,#ffc596_0%,#ff7a1a_45%,#a94400_100%)]"
    : "bg-[radial-gradient(circle_at_35%_30%,#f4f4f4_0%,#b9b9b9_45%,#5c5c5c_100%)]";
  return (
    <span
      data-pip=""
      className={`relative flex items-center justify-center rounded-full ${dims} ${metal} shadow-[0_1px_1px_rgba(0,0,0,0.6),inset_0_-1px_1px_rgba(0,0,0,0.35)]`}
    >
      {size === "lg" || size === "md" ? (
        <span className="h-[38%] w-[38%] bg-black/55 [clip-path:polygon(25%_5%,75%_5%,100%_50%,75%_95%,25%_95%,0%_50%)]" />
      ) : null}
    </span>
  );
}

export interface DieProps {
  face: number;
  size?: DieSize;
  motion?: DieMotion;
  /** Position in the row: picks the resting angle and the landing delay. */
  order?: number;
  /** 10,000: this die is selected to be set aside. */
  selected?: boolean;
  /** 10,000: this die can't score, shown dimmed. */
  dead?: boolean;
  onToggle?: () => void;
  label?: string;
}

export function Die({ face, size = "lg", motion = "rest", order = 0, selected, dead, onToggle, label }: DieProps) {
  const pips = PIPS[face] ?? [];
  const slot = order % 6;
  const cells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const on = pips.some(([r, c]) => r === row && c === col);
      cells.push(
        <span key={`${row}-${col}`} className="flex items-center justify-center">
          {on ? <Bolt ace={face === 1} size={size} /> : null}
        </span>,
      );
    }
  }
  const motionClass =
    motion === "land"
      ? `animate-dice-land ${TILT[slot]} ${SPIN[slot]} ${DELAY[slot]}`
      : motion === "rattle"
        ? `animate-dice-rattle ${DELAY[slot]}`
        : motion === "fade"
          ? `animate-dice-fade ${DELAY[slot]} ${REST[slot]}`
          : REST[slot];
  const lift = selected ? "-translate-y-1.5 ring-2 ring-brand-orange ring-offset-2 ring-offset-[#5f5d59]" : "";
  const shown = face >= 1 && face <= 6 ? face : 0;
  const name = label ?? (shown === 0 ? "Die, not rolled" : `Die showing ${shown}`);
  const body = (
    <span
      data-testid="die"
      data-face={shown}
      className={`grid grid-cols-3 grid-rows-3 ${SIZE[size].box} ${SIZE[size].pad} bg-[#191919] bg-grip [background-size:96px] shadow-[inset_0_1px_0_rgba(255,255,255,0.09),inset_0_-3px_0_rgba(0,0,0,0.55),0_8px_14px_-4px_rgba(0,0,0,0.7)] ${dead ? "opacity-40" : ""} ${shown === 0 ? "opacity-70" : ""}`}
    >
      {cells}
    </span>
  );
  if (onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={Boolean(selected)}
        aria-label={`${name}${selected ? ", set aside" : ""}`}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[14px] transition-transform duration-150 ${motionClass}`}
      >
        <span className={`inline-flex rounded-[12px] transition-transform duration-150 ${lift}`}>{body}</span>
      </button>
    );
  }
  return (
    <span role="img" aria-label={name} className={`inline-flex ${motionClass}`}>
      {body}
    </span>
  );
}

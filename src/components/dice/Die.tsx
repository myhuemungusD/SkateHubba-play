import { useReducedMotion } from "../../hooks/useReducedMotion";

/** Pip cells on a 3×3 face. Row, then column. */
const ACE: ReadonlyArray<readonly [number, number]> = [[1, 1]];

const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: ACE,
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

/**
 * One die. A slight resting tilt stands in for the cube face; while the
 * roll is in flight the tumble keyframe takes over. Reduced motion snaps
 * straight to the face.
 */
export function Die({ face, tumbling }: { face: number; tumbling: boolean }) {
  const reduced = useReducedMotion();
  const pips = PIPS[face] ?? ACE;
  const spin = tumbling && !reduced;
  const shown = pips === ACE && face !== 1 ? 1 : face;
  const cells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const on = pips.some(([r, c]) => r === row && c === col);
      cells.push(
        <span key={`${row}-${col}`} className="flex items-center justify-center">
          {on ? <span data-pip="" className="h-2 w-2 rounded-full bg-black" /> : null}
        </span>,
      );
    }
  }
  return (
    <div className="[perspective:400px]" data-testid="die">
      <div
        role="img"
        aria-label={spin ? "Rolling" : `Die showing ${shown}`}
        data-face={shown}
        className={`grid h-16 w-16 grid-cols-3 grid-rows-3 rounded-xl bg-white p-1.5 shadow-card ${
          spin ? "animate-dice-tumble" : "[transform:rotateX(12deg)_rotateY(-16deg)]"
        }`}
      >
        {cells}
      </div>
    </div>
  );
}

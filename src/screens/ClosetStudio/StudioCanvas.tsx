import { useEffect, useRef } from "react";
import { CANVAS_SIZE, type StudioDoc } from "../../lib/closetStudio/engine";
import { pinch, toCanvas, type Pt, type View } from "../../lib/closetStudio/geometry";

export type Tool = "fill" | "brush" | "eraser" | "eyedropper" | "sticker" | "text";

interface Props {
  doc: StudioDoc;
  version: number;
  view: View;
  onView: (v: View) => void;
  /** One-finger gesture in canvas coords. */
  onDown: (p: Pt) => void;
  onMove: (p: Pt) => void;
  onUp: () => void;
}

/**
 * The drawing surface. One pointer paints; a second pointer turns the gesture
 * into pinch-zoom/pan (and cancels the stroke, like Procreate). The canvas is
 * scaled with a CSS transform, and pointer coords are mapped back through the
 * element's on-screen rect, so the tools stay exact at any zoom.
 */
export function StudioCanvas({ doc, version, view, onView, onDown, onMove, onUp }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, Pt>());
  const painting = useRef(false);

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.drawImage(doc.composite(), 0, 0);
  }, [doc, version]);

  const local = (e: React.PointerEvent): Pt =>
    toCanvas(e.clientX, e.clientY, (e.currentTarget as HTMLElement).getBoundingClientRect(), CANVAS_SIZE);

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      painting.current = true;
      onDown(local(e));
    } else if (painting.current) {
      painting.current = false;
      onUp();
    }
  };

  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 2) {
      const [other] = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
      onView(pinch(view, prev, other, next, other));
    } else if (painting.current) {
      onMove(local(e));
    }
    pointers.current.set(e.pointerId, next);
  };

  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (painting.current && pointers.current.size === 0) {
      painting.current = false;
      onUp();
    }
  };

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[min(100vw,512px)] overflow-hidden rounded-2xl border border-border bg-[repeating-conic-gradient(#1f1f1f_0%_25%,#2a2a2a_0%_50%)] bg-[length:24px_24px]"
      data-testid="studio-stage"
    >
      <canvas
        ref={ref}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        data-testid="studio-canvas"
        aria-label="Design canvas"
        className="h-full w-full touch-none select-none"
        style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
    </div>
  );
}

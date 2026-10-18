import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { isShoe360Enabled } from "../lib/featureFlags";
import { canUseWebGL } from "../runner/webgl";
import { shoeSkinFor } from "../lib/closet/shoe360";

const Shoe360Canvas = lazy(() => import("../closet360/Shoe360Canvas"));

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 360 view of a signature shoe: drag to spin, gentle auto-rotate. Shows the
 * 2D card instead when the flag is off, the design has no skin yet, WebGL is
 * missing, or the scene fails to load. Pauses rendering while off screen.
 */
export function Shoe360({ itemDefId, imageUrl, alt }: { itemDefId: string; imageUrl: string; alt: string }) {
  const skin = shoeSkinFor(itemDefId);
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const image = <img src={imageUrl} alt={alt} className="h-full w-full object-cover" data-testid="shoe360-fallback" />;
  if (!skin || !isShoe360Enabled() || !canUseWebGL()) {
    return <div className="aspect-square w-full overflow-hidden rounded-xl">{image}</div>;
  }
  return (
    <div
      ref={ref}
      role="img"
      aria-label={`${alt}, 360 view. Drag to spin.`}
      data-testid="shoe360"
      className="relative aspect-square w-full touch-none overflow-hidden rounded-xl bg-[radial-gradient(circle_at_50%_42%,#26262a,#0e0e10)]"
    >
      <Fallback fallback={image}>
        <Suspense fallback={image}>
          <Shoe360Canvas skin={skin} autoRotate={!prefersReducedMotion()} active={active} />
        </Suspense>
      </Fallback>
      <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 font-display text-[9px] tracking-widest text-white/80">
        360°
      </span>
    </div>
  );
}

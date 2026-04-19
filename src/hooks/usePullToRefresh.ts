import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playHaptic } from "../services/haptics";

/** Distance past which a drag commits to a refresh on release. Exported so the
 *  indicator component can key its arrow rotation off the same value instead
 *  of duplicating the magic number. */
export const TRIGGER_DISTANCE = 72;
/** Max pixels the indicator can be dragged down. Drag past this feels elastic. */
const MAX_DRAG = 140;
/** Resistance factor — drag distance is attenuated so the gesture feels
 *  weighted rather than 1:1. Matches iOS system PTR feel. */
const RESISTANCE = 0.45;

export type PullToRefreshState = "idle" | "pulling" | "ready" | "refreshing";

export interface PullToRefreshBindings {
  /** Spread onto the scroll container so the hook can observe touch events. */
  containerProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
  /** Current drag offset in pixels (0 when idle). Drive the indicator with this. */
  offset: number;
  /** Lifecycle state of the gesture. */
  state: PullToRefreshState;
  /** True once offset has crossed the trigger threshold. Gives visual feedback
   *  ("release to refresh") before the user actually lifts their finger. */
  triggerReached: boolean;
}

/**
 * Touch/pointer driven pull-to-refresh.
 *
 * The hook owns gesture detection; the caller provides an async `onRefresh`
 * callback that runs when the user releases past the trigger threshold. The
 * caller also decides how to render the indicator, reading `offset` and
 * `state` from the returned bindings — this keeps the hook framework-agnostic
 * and lets each screen style its refresh chrome in-brand.
 *
 * The gesture only activates when the scroll container is at the top
 * (scrollTop === 0). Mid-scroll, pointerDown is ignored so vertical scroll
 * keeps working normally.
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void): PullToRefreshBindings {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<PullToRefreshState>("idle");
  const startYRef = useRef<number | null>(null);
  const committedRef = useRef(false);
  // Tracks whether the drag has already crossed the trigger threshold on the
  // current pull. Ref-based so the "fire haptic once" guard doesn't rely on
  // React state batching — pointermove handlers run at 60Hz and closure-reads
  // of the latest offset aren't guaranteed in every environment.
  const crossedRef = useRef(false);
  // Most recent onRefresh reference — avoids re-binding pointer handlers on
  // every render while still always calling the latest callback.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Drive `triggerReached` off the state machine rather than the live offset
  // so callers see the same commit semantics the hook uses on release:
  // once a pull has crossed the threshold on this gesture, we stay committed
  // until cancel/release, regardless of a subsequent pullback under the line.
  const triggerReached = state === "ready" || state === "refreshing";

  const reset = useCallback(() => {
    startYRef.current = null;
    committedRef.current = false;
    crossedRef.current = false;
    setOffset(0);
    setState("idle");
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only track the primary pointer / first touch. Secondary touches (pinch,
    // two-finger scroll) would otherwise spuriously trigger the refresh.
    if (!e.isPrimary) return;
    // Only activate when the document is actually at the top — mid-scroll
    // PTR would fight with normal vertical scrolling.
    const scrollTop = typeof window !== "undefined" ? window.scrollY || document.documentElement.scrollTop || 0 : 0;
    if (scrollTop > 0) return;
    startYRef.current = e.clientY;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (startYRef.current === null) return;
    if (committedRef.current) return;
    const dy = e.clientY - startYRef.current;
    if (dy <= 0) {
      // Dragging up cancels the gesture entirely — user's trying to scroll.
      setOffset(0);
      setState("idle");
      crossedRef.current = false;
      return;
    }
    // Apply resistance so the indicator feels weighted, cap at MAX_DRAG.
    const next = Math.min(MAX_DRAG, dy * RESISTANCE);
    const crossing = next >= TRIGGER_DISTANCE;
    setOffset(next);
    // Latch the committed visual state once the user has crossed on this
    // pull. The commit (crossedRef) is sticky until release or cancel, so
    // letting the label flip back to "Pull to refresh" after a partial
    // pullback would mismatch what handlePointerUp actually does — release
    // still fires the refresh. Keep visual + commit state in agreement:
    // once ready, stay ready.
    setState(crossedRef.current || crossing ? "ready" : "pulling");
    // One-shot haptic when the indicator crosses the trigger point so the
    // user feels the commitment threshold without having to watch the label.
    // Ref-guarded so rapid successive moves past the line don't re-fire.
    if (crossing && !crossedRef.current) {
      crossedRef.current = true;
      playHaptic("toast");
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    if (startYRef.current === null) return;
    if (!crossedRef.current) {
      // Short drag — snap back.
      reset();
      return;
    }
    committedRef.current = true;
    setState("refreshing");
    setOffset(TRIGGER_DISTANCE);
    const result = onRefreshRef.current();
    Promise.resolve(result)
      .catch(() => {
        // Refresh callback owns its own error surfacing; we just release the
        // gesture either way so the indicator doesn't stick visible.
      })
      .finally(() => {
        reset();
      });
  }, [reset]);

  const handlePointerCancel = useCallback(() => {
    // Treat cancellation (scroll takeover, gesture interruption) the same as
    // a too-short drag — snap back without firing the refresh.
    reset();
  }, [reset]);

  // Memoize the handler bag so callers can treat it as stable across renders
  // (useful for dependency arrays, memoized children, and effect semantics).
  const containerProps = useMemo(
    () => ({
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
    }),
    [handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel],
  );

  return { containerProps, offset, state, triggerReached };
}

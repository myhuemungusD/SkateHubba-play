import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRunnerController, type RunnerController } from "../../runner/controller";
import { bindRunnerTouch, createGestureRecognizer } from "../../runner/gestures";
import { FLICK_SENSITIVITY } from "../../runner/tune";
import { actionForKey, isTypingTarget } from "../../runner/keyboard";
import { preloadRunnerSfx } from "../../runner/sfx";
import { canUseWebGL, frameDelta, noteFps, type FpsBucket } from "../../runner/webgl";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { RunnerWorld } from "../../runner/view/RunnerWorld";
import { RunnerHud } from "./RunnerHud";

interface Props {
  /** Tests pass a controller so they can place a barrier and step the run. */
  controller?: RunnerController;
}

/**
 * Endless street of rails and ledges. The sim ticks here, on
 * requestAnimationFrame, so a missing WebGL context still scores the run.
 * The canvas is a view of that state. three.js is only imported by the lazy
 * world module, never by this file's callers — App loads this screen with
 * React.lazy. The score stays on this run.
 */
export function RunnerScreen({ controller: injected }: Props = {}) {
  const reduced = useReducedMotion();
  const [webgl] = useState(() => canUseWebGL());
  const [owned] = useState(() => injected ?? createRunnerController({ startPaused: reduced }));
  const controller = injected ?? owned;
  const hud = useSyncExternalStore(controller.subscribe, controller.getHud, controller.getHud);
  const rootRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef(createGestureRecognizer());
  const [sensitivity, setSensitivity] = useState(FLICK_SENSITIVITY);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return bindRunnerTouch(
      el,
      gesture.current,
      (action, grade) => {
        controller.input(action, grade);
      },
      (lean) => {
        controller.setLean(lean);
      },
    );
  }, [controller]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) return;
      const status = controller.getState().status;
      if (status === "gameover" && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        controller.restart();
        return;
      }
      if (event.repeat) return;
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") controller.setLean(-1);
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") controller.setLean(1);
      const action = actionForKey(event.key);
      if (!action) return;
      event.preventDefault();
      if (action === "pause") {
        if (status === "playing") controller.pause();
        else if (status === "paused") controller.resume();
        return;
      }
      controller.input(action);
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") controller.setLean(0);
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") controller.setLean(0);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [controller]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "hidden") return;
      if (controller.getState().status === "playing") controller.pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [controller]);

  useEffect(() => {
    preloadRunnerSfx();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const bucket: FpsBucket = { frames: 0, stamp: 0 };
    const tick = (now: number) => {
      const dt = frameDelta(now, last);
      last = now;
      controller.step(dt);
      if (!webgl) noteFps(fpsRef.current, bucket, now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [controller, webgl]);

  return (
    <div
      ref={rootRef}
      data-testid="runner-screen"
      className="fixed inset-0 z-40 overflow-hidden overscroll-none bg-[#121212] text-white select-none"
      aria-describedby="runner-help"
    >
      <div aria-hidden className="absolute inset-y-0 left-0 z-20 w-8 touch-pan-y" />
      <div aria-hidden className="absolute inset-y-0 right-0 z-20 w-8 touch-pan-y" />
      {webgl ? (
        <RunnerWorld
          controller={controller}
          reducedMotion={reduced}
          active={hud.status === "playing"}
          fpsRef={fpsRef}
        />
      ) : (
        <p
          data-testid="runner-no-webgl"
          className="absolute inset-x-0 top-24 px-8 text-center font-body text-sm text-white/70"
        >
          3D view needs WebGL. The run still counts.
        </p>
      )}
      <RunnerHud
        hud={hud}
        fpsRef={fpsRef}
        onPause={() => controller.pause()}
        onResume={() => controller.resume()}
        onRestart={() => controller.restart()}
        sensitivity={sensitivity}
        onToggleControl={() => controller.setStreamlined(!controller.isStreamlined())}
        onSensitivity={(value) => {
          setSensitivity(value);
          gesture.current.setSensitivity(value);
        }}
      />
    </div>
  );
}

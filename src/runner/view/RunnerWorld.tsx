import { Component, memo, useRef, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Color } from "three";
import type { RunnerController } from "../controller";
import { noteFps, type FpsBucket } from "../webgl";
import { Board } from "./Board";
import { Effects } from "./Effects";
import { ObstaclePool } from "./ObstaclePool";
import { Street } from "./Street";

interface WorldProps {
  controller: RunnerController;
  reducedMotion: boolean;
  active: boolean;
  fpsRef: RefObject<HTMLElement | null>;
}

/**
 * Local boundary so a lost WebGL context does not page Sentry. The sim keeps
 * running behind the message. Nothing in a run is saved.
 */
class RunnerCanvasError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="absolute inset-x-0 top-24 px-8 text-center font-body text-sm text-white/70">
          3D view unavailable. The run still counts.
        </p>
      );
    }
    return this.props.children;
  }
}

function CameraRig({
  controller,
  reducedMotion,
  fpsRef,
}: {
  controller: RunnerController;
  reducedMotion: boolean;
  fpsRef: RefObject<HTMLElement | null>;
}) {
  const bucket = useRef<FpsBucket>({ frames: 0, stamp: 0 });

  useFrame(({ camera }) => {
    noteFps(fpsRef.current, bucket.current, performance.now());
    const state = controller.getState();
    const bob = reducedMotion ? 0 : Math.sin(state.distance * 0.35) * 0.012;
    // Far enough back that the whole deck and four wheels sit in frame on a phone.
    camera.position.set(state.x * 0.2 + 0.7, 4.2 + bob, 3.6);
    camera.lookAt(state.x * 0.05, 0.22, -0.9);
  });

  return null;
}

/**
 * The 3D view. three.js stays in this lazy chunk. Pixel ratio is capped,
 * MSAA is off, and lights do not cast shadow maps — the board carries a
 * blob shadow instead, which is what holds 60fps on a mid-range phone.
 */
function RunnerCanvas({ controller, reducedMotion, active, fpsRef }: WorldProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      shadows={false}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [0.7, 4.2, 3.6], fov: 38, near: 0.05, far: 80 }}
      onCreated={({ gl, scene }) => {
        gl.shadowMap.enabled = false;
        scene.background = new Color("#241f1b");
      }}
    >
      <fog attach="fog" args={["#241f1b", 12, 42]} />
      <hemisphereLight args={["#f0e2c8", "#3a3228", 0.72]} />
      <ambientLight intensity={0.22} />
      <directionalLight position={[5, 8, 3]} intensity={1.25} color="#fff1d6" castShadow={false} />
      <directionalLight position={[-4, 3, -6]} intensity={0.28} color="#7f93a8" castShadow={false} />
      <CameraRig controller={controller} reducedMotion={reducedMotion} fpsRef={fpsRef} />
      <Street controller={controller} />
      <ObstaclePool controller={controller} />
      <Board controller={controller} />
      <Effects controller={controller} reducedMotion={reducedMotion} />
    </Canvas>
  );
}

export const RunnerWorld = memo(function RunnerWorld(props: WorldProps) {
  return (
    <div className="absolute inset-0 touch-none" aria-hidden>
      <RunnerCanvasError>
        <RunnerCanvas {...props} />
      </RunnerCanvasError>
    </div>
  );
});

import { Component, memo, useRef, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Color } from "three";
import type { RunnerController } from "../controller";
import { noteFps, type FpsBucket } from "../webgl";
import { ObstaclePool } from "./ObstaclePool";
import { SkaterAvatar } from "./SkaterAvatar";
import { Street } from "./Street";

interface WorldProps {
  controller: RunnerController;
  reducedMotion: boolean;
  active: boolean;
  fpsRef: RefObject<HTMLElement | null>;
}

/**
 * Local boundary so a lost WebGL context does not page Sentry. The sim keeps
 * running behind the message; phase 1 has nothing to save.
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
    const bob = reducedMotion ? 0 : Math.sin(state.distance * 0.35) * 0.04;
    camera.position.set(state.x * 0.22, 2.5 + bob, 5.5);
    camera.lookAt(state.x * 0.12, 0.85, -8);
  });

  return null;
}

/**
 * The 3D view. Imports of drei stay on core subpaths so this chunk does not
 * pull the drei barrel (mediapipe, stats, text). Pixel ratio is capped, and
 * lights do not cast shadows.
 */
function RunnerCanvas({ controller, reducedMotion, active, fpsRef }: WorldProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      shadows={false}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [0, 2.5, 5.5], fov: 60, near: 0.1, far: 80 }}
      onCreated={({ gl, scene }) => {
        gl.shadowMap.enabled = false;
        scene.background = new Color("#121212");
      }}
    >
      <fog attach="fog" args={["#121212", 16, 48]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 8, 4]} intensity={0.55} castShadow={false} />
      <CameraRig controller={controller} reducedMotion={reducedMotion} fpsRef={fpsRef} />
      <Street controller={controller} />
      <ObstaclePool controller={controller} />
      <SkaterAvatar controller={controller} />
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

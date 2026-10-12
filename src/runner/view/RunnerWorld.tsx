import { Component, memo, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, Color, PCFSoftShadowMap } from "three";
import type { RunnerController } from "../controller";
import { emptyShake, stepPerfectShake } from "../juice";
import { currentRunnerQuality, type RunnerQuality } from "../quality";
import { noteFps, type FpsBucket } from "../webgl";
import { Board } from "./Board";
import { Effects } from "./Effects";
import { GhostBoard } from "./GhostBoard";
import { ObstaclePool } from "./ObstaclePool";
import { Street } from "./Street";
import { mountRunnerEnvironment } from "./textures";

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
  const shake = useRef(emptyShake());
  const wasGrind = useRef(false);

  useFrame(({ camera }, dt) => {
    noteFps(fpsRef.current, bucket.current, performance.now());
    const state = controller.getState();
    const frame = controller.getRenderFrame();
    const offset = stepPerfectShake(
      shake.current,
      {
        onGrind: state.onGrind,
        wasOnGrind: wasGrind.current,
        grade: state.grade,
        reducedMotion,
      },
      dt,
    );
    wasGrind.current = state.onGrind;
    const bob = reducedMotion ? 0 : Math.sin(frame.distance * 0.35) * 0.012;
    // Wider, higher, and further back than round 2. The horizon stays on
    // screen so the next rail sits in the upper half, and the board is about
    // half the size it was. Shake is zero except on a perfect lock.
    const follow = frame.x;
    camera.position.set(follow * 0.62 + 0.15 + offset.x, 4.7 + bob + offset.y, 5.6);
    camera.lookAt(follow * 0.28, 0.12, -6.2);
  });

  return null;
}

function RunnerEnvironment() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => mountRunnerEnvironment(gl, scene), [gl, scene]);
  return null;
}

/**
 * The 3D view. three.js stays in this lazy chunk. Pixel ratio is capped
 * and MSAA is off. Phones skip the shadow map and keep the blob under the
 * board. A desktop draws one 512 soft shadow. Lamp glow is an additive
 * card, not a bloom pass. The dusk HDRI is environment lighting only.
 */
function RunnerCanvas({ controller, reducedMotion, active, fpsRef }: WorldProps) {
  const quality = useMemo((): RunnerQuality => currentRunnerQuality(), []);
  const high = quality === "high";
  return (
    <Canvas
      dpr={[1, 1.5]}
      shadows={high}
      frameloop={active ? "always" : "never"}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [0.15, 4.7, 5.6], fov: 55, near: 0.05, far: 120 }}
      onCreated={({ gl, scene }) => {
        gl.shadowMap.enabled = high;
        if (high) gl.shadowMap.type = PCFSoftShadowMap;
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.92;
        scene.background = new Color("#1c140f");
      }}
    >
      <RunnerEnvironment />
      <fog attach="fog" args={["#1c140f", 28, 92]} />
      <hemisphereLight args={["#ffb36a", "#2a160f", 0.38]} />
      <ambientLight intensity={0.14} color="#ffd7a8" />
      <directionalLight
        position={[6, 8, 5]}
        intensity={high ? 0.95 : 0.7}
        color="#ffc48a"
        castShadow={high}
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
        shadow-camera-near={2}
        shadow-camera-far={22}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <directionalLight position={[-5, 3, -4]} intensity={0.16} color="#6a7ea0" />
      <CameraRig controller={controller} reducedMotion={reducedMotion} fpsRef={fpsRef} />
      <Street controller={controller} quality={quality} />
      <ObstaclePool controller={controller} quality={quality} />
      <GhostBoard controller={controller} />
      <Board controller={controller} quality={quality} />
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

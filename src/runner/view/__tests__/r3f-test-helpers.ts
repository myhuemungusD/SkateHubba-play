/**
 * Headless react-three-fiber harness for the runner view tests.
 *
 * jsdom has no WebGL, so the real WebGLRenderer cannot start. R3F accepts a
 * ready-made renderer object, so these tests hand it a small fake that has
 * the fields the runner reads (shadow map, tone mapping, pixel ratio) and a
 * spy on render(). Everything else is the real reconciler building real
 * three.js objects, and `frame()` drives useFrame callbacks by hand with
 * frameloop "never", so every frame is deterministic.
 */
import { act, type ReactNode } from "react";
import { createRoot, extend, type ReconcilerRoot, type RootState } from "@react-three/fiber";
import * as THREE from "three";
import type { Object3D, WebGLRenderer } from "three";
import { vi } from "vitest";
import type { RenderFrame, RunnerController } from "../../controller";
import type { RunnerState } from "../../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// <Canvas> registers the three namespace itself; a bare createRoot does not.
// Register the same ESM build the production modules import, so their
// `instanceof Mesh` checks see the objects the reconciler builds.
extend(THREE as unknown as Parameters<typeof extend>[0]);

export interface FakeRenderer {
  shadowMap: { enabled: boolean; type: number };
  toneMapping: number;
  toneMappingExposure: number;
  outputColorSpace: string;
  capabilities: { getMaxAnisotropy: () => number };
  domElement: HTMLCanvasElement;
  xr: {
    enabled: boolean;
    isPresenting: boolean;
    addEventListener: () => void;
    removeEventListener: () => void;
    setAnimationLoop: () => void;
  };
  render: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  setPixelRatio: ReturnType<typeof vi.fn>;
  getPixelRatio: () => number;
  dispose: ReturnType<typeof vi.fn>;
  forceContextLoss: ReturnType<typeof vi.fn>;
  info: { render: { frame: number } };
}

export function fakeRenderer(shadows = false, maxAnisotropy = 16): FakeRenderer {
  return {
    shadowMap: { enabled: shadows, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: "srgb",
    capabilities: { getMaxAnisotropy: () => maxAnisotropy },
    domElement: document.createElement("canvas"),
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setAnimationLoop: () => undefined,
    },
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    getPixelRatio: () => 1,
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    info: { render: { frame: 0 } },
  };
}

export function asRenderer(fake: FakeRenderer): WebGLRenderer {
  return fake as unknown as WebGLRenderer;
}

export interface Scene3D {
  gl: FakeRenderer;
  state: () => RootState;
  /** Run every useFrame subscriber once with this delta (seconds). */
  frame: (dt?: number) => Promise<void>;
  find: (name: string) => Object3D;
  /**
   * Snapshot the current useFrame callbacks. The returned function runs them
   * later, e.g. after unmount, to check a frame that lands once refs are gone.
   */
  captureFrame: () => (dt?: number) => void;
  rerender: (node: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
}

const liveRoots = new Set<ReconcilerRoot<HTMLCanvasElement>>();

/** Unmount every render3D root a test left mounted. Use it in afterEach. */
export async function unmountAll3D(): Promise<void> {
  const roots = [...liveRoots];
  liveRoots.clear();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
}

export async function render3D(node: ReactNode, options: { shadows?: boolean } = {}): Promise<Scene3D> {
  const gl = fakeRenderer(options.shadows ?? false);
  const canvas = document.createElement("canvas");
  const root: ReconcilerRoot<HTMLCanvasElement> = createRoot(canvas);
  liveRoots.add(root);
  let store: { getState: () => RootState } | null = null;
  await act(async () => {
    await root.configure({
      gl: gl as unknown as WebGLRenderer,
      frameloop: "never",
      // R3F writes gl.shadowMap.enabled from this prop, so pass it through.
      shadows: options.shadows ?? false,
      size: { width: 400, height: 800, top: 0, left: 0 },
      dpr: 1,
      events: undefined,
    });
    store = root.render(node);
  });
  const state = (): RootState => {
    if (!store) throw new Error("render3D: root never rendered");
    return store.getState();
  };
  return {
    gl,
    state,
    frame: async (dt = 1 / 60) => {
      await act(async () => {
        const current = state();
        // advance() derives dt from a wall clock; call the subscribers with a
        // fixed dt instead so frames are deterministic. Priority order matches R3F.
        const subs = [...current.internal.subscribers].sort((a, b) => a.priority - b.priority);
        for (const sub of subs) sub.ref.current(current, dt);
      });
    },
    captureFrame: () => {
      const current = state();
      const callbacks = [...current.internal.subscribers].map((sub) => sub.ref.current);
      return (dt = 1 / 60) => {
        for (const callback of callbacks) callback(current, dt);
      };
    },
    find: (name: string) => {
      const found = state().scene.getObjectByName(name);
      if (!found) throw new Error(`no object named ${name}`);
      return found;
    },
    rerender: async (next: ReactNode) => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount: async () => {
      liveRoots.delete(root);
      await act(async () => {
        root.unmount();
      });
    },
  };
}

/** A controller whose state and frame are plain objects the test edits. */
export function fakeController(
  state: Partial<RunnerState> = {},
  frame: Partial<RenderFrame> = {},
): RunnerController & { state: RunnerState; frame: RenderFrame } {
  const s = {
    status: "playing",
    onGrind: false,
    duck: -1,
    grade: null,
    speed: 10,
    obstacles: [],
    ...state,
  } as unknown as RunnerState;
  const f = {
    x: 0,
    y: 0,
    distance: 0,
    speed: 10,
    pitch: 0,
    yaw: 0,
    roll: 0,
    spin: 0,
    squash: 0,
    ...frame,
  } as unknown as RenderFrame;
  const controller = {
    state: s,
    frame: f,
    getState: () => controller.state,
    getRenderFrame: () => controller.frame,
    getGhost: vi.fn(() => []),
  };
  return controller as unknown as RunnerController & { state: RunnerState; frame: RenderFrame };
}

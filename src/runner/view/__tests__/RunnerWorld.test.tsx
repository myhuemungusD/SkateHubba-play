import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  AmbientLight,
  type Object3D,
} from "three";
import { fakeController, render3D, type Scene3D } from "./r3f-test-helpers";
import { RunnerWorld } from "../RunnerWorld";
import type { RunnerQuality } from "../../quality";

interface CanvasProps {
  children: ReactNode;
  onCreated: (state: { gl: unknown; scene: unknown }) => void;
  dpr: [number, number];
  shadows: boolean;
  frameloop: string;
  gl: Record<string, unknown>;
  camera: Record<string, unknown>;
}

const harness = vi.hoisted(() => ({
  quality: "low" as RunnerQuality,
  canvas: null as null | CanvasProps,
  failCanvas: false,
  environmentCleanup: vi.fn(),
  mountEnvironment: vi.fn(),
}));

// jsdom has no WebGL, so the Canvas only records its props and children.
// Each test renders those children in the headless R3F root from the helpers.
vi.mock("@react-three/fiber", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Canvas: (props: CanvasProps) => {
    if (harness.failCanvas) throw new Error("WebGL context lost");
    harness.canvas = props;
    return null;
  },
}));
vi.mock("../../quality", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  currentRunnerQuality: () => harness.quality,
}));
vi.mock("../textures", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mountRunnerEnvironment: harness.mountEnvironment,
}));
vi.mock("../Board", () => ({ Board: ({ quality }: { quality: string }) => <group name={`Board:${quality}`} /> }));
vi.mock("../Street", () => ({ Street: ({ quality }: { quality: string }) => <group name={`Street:${quality}`} /> }));
vi.mock("../ObstaclePool", () => ({
  ObstaclePool: ({ quality }: { quality: string }) => <group name={`ObstaclePool:${quality}`} />,
}));
vi.mock("../GhostBoard", () => ({ GhostBoard: () => <group name="GhostBoard" /> }));
vi.mock("../Effects", () => ({
  Effects: ({ reducedMotion }: { reducedMotion: boolean }) => <group name={`Effects:${String(reducedMotion)}`} />,
}));
vi.mock("../Bloom", () => ({ RunnerBloom: () => <group name="RunnerBloom" /> }));

let scene: Scene3D | null = null;

beforeEach(() => {
  harness.quality = "low";
  harness.canvas = null;
  harness.failCanvas = false;
  harness.environmentCleanup.mockReset();
  harness.mountEnvironment.mockReset();
  harness.mountEnvironment.mockReturnValue(harness.environmentCleanup);
});

afterEach(async () => {
  await scene?.unmount();
  scene = null;
  vi.restoreAllMocks();
});

function canvasProps(): CanvasProps {
  if (!harness.canvas) throw new Error("Canvas never rendered");
  return harness.canvas;
}

function world(props: Partial<{ reducedMotion: boolean; active: boolean; fps: HTMLElement | null }> = {}) {
  const controller = fakeController();
  const fpsRef = { current: props.fps ?? null };
  return {
    controller,
    node: (
      <RunnerWorld
        controller={controller}
        reducedMotion={props.reducedMotion ?? false}
        active={props.active ?? true}
        fpsRef={fpsRef}
      />
    ),
  };
}

async function mountScene(): Promise<Scene3D> {
  scene = await render3D(canvasProps().children, { shadows: harness.quality === "high" });
  canvasProps().onCreated({ gl: scene.gl, scene: scene.state().scene });
  return scene;
}

function ofType<T extends Object3D>(root: Object3D, type: new (...args: never[]) => T): T[] {
  return root.children.filter((child): child is T => child instanceof type);
}

describe("RunnerWorld", () => {
  it("sets a phone-tier canvas: dpr 1, no shadows, no MSAA, frames only while active", () => {
    const { node } = world({ active: false });
    const { container } = render(node);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    const props = canvasProps();
    expect(props.dpr).toEqual([1, 1]);
    expect(props.shadows).toBe(false);
    expect(props.frameloop).toBe("never");
    expect(props.gl).toEqual({ antialias: false, powerPreference: "high-performance", stencil: false });
    expect(props.camera).toEqual({ position: [0.15, 4.7, 5.6], fov: 55, near: 0.05, far: 120 });

    render(world({ active: true }).node);
    expect(canvasProps().frameloop).toBe("always");
  });

  it("lights the phone tier with one key light and no bloom, and tones the renderer on create", async () => {
    render(world().node);
    const s = await mountScene();
    const root = s.state().scene;
    expect(s.gl.shadowMap.enabled).toBe(false);
    expect(s.gl.toneMapping).toBe(ACESFilmicToneMapping);
    expect(s.gl.toneMappingExposure).toBe(0.92);
    expect((root.background as Color).getHexString()).toBe(new Color("#1c140f").getHexString());
    expect(root.fog).toBeInstanceOf(Fog);
    expect([(root.fog as Fog).near, (root.fog as Fog).far]).toEqual([28, 92]);

    expect(ofType(root, HemisphereLight)[0]?.intensity).toBe(0.48);
    expect(ofType(root, AmbientLight)).toHaveLength(0);
    const lights = ofType(root, DirectionalLight);
    expect(lights).toHaveLength(1);
    expect(lights[0]?.intensity).toBe(0.7);
    expect(lights[0]?.castShadow).toBe(false);
    expect(lights[0]?.shadow.mapSize.toArray()).toEqual([512, 512]);
    expect(lights[0]?.shadow.camera.far).toBe(22);

    for (const name of ["Street:low", "ObstaclePool:low", "GhostBoard", "Board:low", "Effects:false"]) {
      expect(s.find(name)).toBeDefined();
    }
    expect(root.getObjectByName("RunnerBloom")).toBeUndefined();
    expect(harness.mountEnvironment).toHaveBeenCalledWith(s.gl, root);
  });

  it("adds the soft shadow map, fill lights, and bloom on the high tier", async () => {
    harness.quality = "high";
    render(world({ reducedMotion: true }).node);
    expect(canvasProps().dpr).toEqual([1, 1.5]);
    expect(canvasProps().shadows).toBe(true);
    const s = await mountScene();
    const root = s.state().scene;
    expect(s.gl.shadowMap.enabled).toBe(true);
    expect(s.gl.shadowMap.type).toBe(PCFSoftShadowMap);
    expect(ofType(root, HemisphereLight)[0]?.intensity).toBe(0.38);
    expect(ofType(root, AmbientLight)[0]?.intensity).toBe(0.14);
    const lights = ofType(root, DirectionalLight);
    expect(lights.map((light) => light.intensity)).toEqual([0.95, 0.16]);
    expect(lights[0]?.castShadow).toBe(true);
    expect(s.find("RunnerBloom")).toBeDefined();
    expect(s.find("Effects:true")).toBeDefined();
    expect(s.find("Board:high")).toBeDefined();
  });

  it("frees the environment map when the canvas goes", async () => {
    render(world().node);
    const s = await mountScene();
    await s.unmount();
    scene = null;
    expect(harness.environmentCleanup).toHaveBeenCalled();
  });

  it("shows a short note instead of crashing when WebGL fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    harness.failCanvas = true;
    render(world().node);
    expect(screen.getByText("3D view unavailable. The run still counts.")).toBeTruthy();
  });
});

describe("CameraRig", () => {
  it("follows the board from high and behind with a gentle bob", async () => {
    const { controller, node } = world();
    controller.frame.x = 1.7;
    controller.frame.distance = 4;
    render(node);
    const s = await mountScene();
    await s.frame(0.016);
    const camera = s.state().camera;
    expect(camera.position.x).toBeCloseTo(1.7 * 0.62 + 0.15);
    expect(camera.position.y).toBeCloseTo(4.7 + Math.sin(4 * 0.35) * 0.012);
    expect(camera.position.z).toBe(5.6);
  });

  it("drops the bob and the shake under reduced motion", async () => {
    const { controller, node } = world({ reducedMotion: true });
    controller.frame.distance = 4;
    controller.state.onGrind = true;
    controller.state.grade = "perfect" as never;
    render(node);
    const s = await mountScene();
    await s.frame(0.016);
    expect(s.state().camera.position.y).toBe(4.7);
    expect(s.state().camera.position.x).toBeCloseTo(0.15);
  });

  it("shakes the camera once when a perfect grind locks, then settles", async () => {
    const { controller, node } = world();
    render(node);
    const s = await mountScene();
    await s.frame(0.016);
    const rest = s.state().camera.position.x;
    controller.state.onGrind = true;
    controller.state.grade = "perfect" as never;
    await s.frame(0.016);
    expect(s.state().camera.position.x).not.toBeCloseTo(rest, 5);
    for (let i = 0; i < 30; i += 1) await s.frame(0.016);
    expect(s.state().camera.position.x).toBeCloseTo(rest, 5);
  });

  it("writes the frame rate to the FPS readout every half second", async () => {
    const fps = document.createElement("span");
    const now = vi.spyOn(performance, "now");
    render(world({ fps }).node);
    const s = await mountScene();
    for (const t of [1000, 1100, 1200, 1300, 1400, 1500]) {
      now.mockReturnValue(t);
      await s.frame(0.1);
    }
    expect(fps.textContent).toBe("12");
  });
});

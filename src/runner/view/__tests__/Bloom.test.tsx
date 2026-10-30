import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render3D, type Scene3D } from "./r3f-test-helpers";
import { RunnerBloom } from "../Bloom";
import { BLOOM_MIPS, BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD } from "../../tune";
import { expectWarned, expectNotWarned } from "./warn-test-helpers";

interface FakePass {
  kind: string;
  args: unknown[];
}

const composer = vi.hoisted(() => ({
  instances: [] as Array<{
    gl: unknown;
    passes: FakePass[];
    pixelRatio: number;
    size: number[];
    renders: number;
    disposed: boolean;
  }>,
  nMips: 5,
}));

vi.mock("three/examples/jsm/postprocessing/EffectComposer.js", () => ({
  EffectComposer: class {
    record = {
      gl: null as unknown,
      passes: [] as FakePass[],
      pixelRatio: 0,
      size: [] as number[],
      renders: 0,
      disposed: false,
    };
    constructor(gl: unknown) {
      this.record.gl = gl;
      composer.instances.push(this.record);
    }
    addPass(pass: FakePass) {
      this.record.passes.push(pass);
    }
    setPixelRatio(ratio: number) {
      this.record.pixelRatio = ratio;
    }
    setSize(width: number, height: number) {
      this.record.size = [width, height];
    }
    render() {
      this.record.renders += 1;
    }
    dispose() {
      this.record.disposed = true;
    }
  },
}));
vi.mock("three/examples/jsm/postprocessing/RenderPass.js", () => ({
  RenderPass: class {
    kind = "render";
    args: unknown[];
    constructor(...args: unknown[]) {
      this.args = args;
    }
  },
}));
vi.mock("three/examples/jsm/postprocessing/UnrealBloomPass.js", () => ({
  UnrealBloomPass: class {
    kind = "bloom";
    args: unknown[];
    nMips = composer.nMips;
    constructor(...args: unknown[]) {
      this.args = args;
    }
  },
}));
vi.mock("three/examples/jsm/postprocessing/OutputPass.js", () => ({
  OutputPass: class {
    kind = "output";
    args: unknown[] = [];
  },
}));

let scene: Scene3D | null = null;

beforeEach(() => {
  composer.instances.length = 0;
  composer.nMips = BLOOM_MIPS;
});

afterEach(async () => {
  await scene?.unmount();
  scene = null;
  vi.restoreAllMocks();
});

describe("RunnerBloom", () => {
  it("chains render, bloom, and output passes sized to the canvas", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    scene = await render3D(<RunnerBloom />);
    const [effect] = composer.instances;
    expect(effect?.gl).toBe(scene.gl);
    expect(effect?.passes.map((pass) => pass.kind)).toEqual(["render", "bloom", "output"]);
    const state = scene.state();
    expect(effect?.passes[0]?.args).toEqual([state.scene, state.camera]);
    const [resolution, ...bloom] = effect?.passes[1]?.args ?? [];
    expect((resolution as { toArray: () => number[] }).toArray()).toEqual([400, 800]);
    expect(bloom).toEqual([BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD]);
    expect(effect?.pixelRatio).toBe(1);
    expect(effect?.size).toEqual([400, 800]);
    expectNotWarned(warn, ["bloom", "mip", "drift"]);
  });

  it("takes over the frame's render at priority 1", async () => {
    scene = await render3D(<RunnerBloom />);
    const subscriber = [...scene.state().internal.subscribers][0];
    expect(subscriber?.priority).toBe(1);
    await scene.frame();
    await scene.frame();
    expect(composer.instances[0]?.renders).toBe(2);
  });

  it("warns when three changes the bloom mip count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    composer.nMips = 3;
    scene = await render3D(<RunnerBloom />);
    expectWarned(warn, ["bloom", "mip", "drift"], "3");
  });

  it("frees the composer on unmount", async () => {
    scene = await render3D(<RunnerBloom />);
    await scene.unmount();
    scene = null;
    expect(composer.instances[0]?.disposed).toBe(true);
  });
});

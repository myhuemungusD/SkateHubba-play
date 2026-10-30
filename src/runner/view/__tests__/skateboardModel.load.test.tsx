import { useRef, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  Vector3,
  type Object3D,
} from "three";
import { deferred, resetSlots, slots, type Deferred } from "./art-slots-test-helpers";
import { asRenderer, fakeController, fakeRenderer, render3D, type Scene3D } from "./r3f-test-helpers";
import type { RunnerController } from "../../controller";
import {
  BOARD_TARGET_LENGTH,
  fitSkateboard,
  loadRunnerModel,
  placeDeckGraphic,
  useSkateboardModel,
  wheelSpinRate,
} from "../skateboardModel";

vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);

const gltf = vi.hoisted(() => ({
  next: null as null | (() => Promise<{ scene: unknown }>),
  urls: [] as string[],
  wiring: [] as Array<{ draco: unknown; ktx2: unknown; meshopt: unknown }>,
  draco: [] as Array<{ path: string; disposed: boolean }>,
  ktx2: [] as Array<{ path: string; support: unknown; disposed: boolean }>,
  detectError: null as Error | null,
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    wiring = { draco: null as unknown, ktx2: null as unknown, meshopt: null as unknown };
    constructor() {
      gltf.wiring.push(this.wiring);
    }
    setDRACOLoader(loader: unknown) {
      this.wiring.draco = loader;
    }
    setKTX2Loader(loader: unknown) {
      this.wiring.ktx2 = loader;
    }
    setMeshoptDecoder(decoder: unknown) {
      this.wiring.meshopt = decoder;
    }
    loadAsync(url: string) {
      gltf.urls.push(url);
      if (!gltf.next) throw new Error("no gltf queued");
      return gltf.next();
    }
  },
}));
vi.mock("three/examples/jsm/loaders/DRACOLoader.js", () => ({
  DRACOLoader: class {
    record = { path: "", disposed: false };
    constructor() {
      gltf.draco.push(this.record);
    }
    setDecoderPath(path: string) {
      this.record.path = path;
    }
    dispose() {
      this.record.disposed = true;
    }
  },
}));
vi.mock("three/examples/jsm/loaders/KTX2Loader.js", () => ({
  KTX2Loader: class {
    record = { path: "", support: null as unknown, disposed: false };
    constructor() {
      gltf.ktx2.push(this.record);
    }
    setTranscoderPath(path: string) {
      this.record.path = path;
    }
    detectSupport(renderer: unknown) {
      if (gltf.detectError) throw gltf.detectError;
      this.record.support = renderer;
    }
    dispose() {
      this.record.disposed = true;
    }
  },
}));
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: { ready: Promise.resolve(), name: "meshopt" },
}));

/** A deck long on X with two named wheel groups under it. */
function boardModel(): { model: Group; deckGeometry: BoxGeometry; texture: Texture; material: MeshStandardMaterial } {
  const model = new Group();
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  const deckGeometry = new BoxGeometry(2, 0.1, 0.5);
  model.add(new Mesh(deckGeometry, material));
  for (const x of [-0.7, 0.7]) {
    const wheel = new Group();
    wheel.name = `Wheel_${x}`;
    wheel.position.set(x, -0.1, 0);
    wheel.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshStandardMaterial()));
    model.add(wheel);
  }
  return { model, deckGeometry, texture, material };
}

beforeEach(() => {
  resetSlots();
  gltf.next = null;
  gltf.urls.length = 0;
  gltf.wiring.length = 0;
  gltf.draco.length = 0;
  gltf.ktx2.length = 0;
  gltf.detectError = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wheelSpinRate", () => {
  it("slows the wheels for a duck, a grind, and air, and rolls full speed otherwise", () => {
    expect(wheelSpinRate({ duck: 0, onGrind: true, airborne: true })).toBe(0.35);
    expect(wheelSpinRate({ duck: -1, onGrind: true, airborne: true })).toBe(0.9);
    expect(wheelSpinRate({ duck: -1, onGrind: false, airborne: true })).toBe(0.45);
    expect(wheelSpinRate({ duck: -1, onGrind: false })).toBe(1.7);
  });
});

describe("fitSkateboard edge cases", () => {
  it("lays a board authored standing up on Y flat, with a thin X axis", () => {
    const mesh = new Mesh(new BoxGeometry(0.05, 2, 0.3, 1, 30, 1), new MeshBasicMaterial());
    fitSkateboard(mesh);
    mesh.updateMatrixWorld(true);
    const size = new Box3().setFromObject(mesh).getSize(new Vector3());
    expect(size.z).toBeCloseTo(BOARD_TARGET_LENGTH, 3);
    expect(size.y).toBeLessThan(size.x);
  });

  it("assumes the positive thin axis is up when there are too few vertices to tell", () => {
    const geometry = new BufferGeometry();
    // Four corners of a thin wedge: enough for a size, too few for a vote.
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 0.1, 0.5, 2, 0.1, 0.5]), 3),
    );
    const root = new Group();
    root.add(new Mesh(geometry, new MeshBasicMaterial()));
    // A mesh with no position attribute is skipped when sampling.
    root.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
    fitSkateboard(root);
    const box = new Box3().setFromObject(root);
    expect(box.getSize(new Vector3()).z).toBeCloseTo(BOARD_TARGET_LENGTH, 3);
    expect(box.min.y).toBeCloseTo(0, 4);
    // Sign +1 keeps source +Y as up: no flip about the long axis.
    const up = new Vector3(0, 1, 0).applyQuaternion(root.quaternion);
    expect(up.y).toBeCloseTo(1, 4);
  });

  it("flips the deck when every sampled vertex sits at one corner", () => {
    // 800 vertices sample every second one. The sampled (even) ones all sit
    // at the origin, so both spans collapse to zero and fall back to 1, and
    // every sample votes for the negative thin end.
    const positions = new Float32Array(800 * 3);
    for (let i = 1; i < 800; i += 2) positions.set([2, 0.1, 0.5], i * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const root = new Group();
    root.add(new Mesh(geometry, new MeshBasicMaterial()));
    fitSkateboard(root);
    expect(new Box3().setFromObject(root).getSize(new Vector3()).z).toBeCloseTo(BOARD_TARGET_LENGTH, 3);
    const up = new Vector3(0, 1, 0).applyQuaternion(root.quaternion);
    expect(up.y).toBeCloseTo(-1, 4);
  });

  it("falls back to the board length for a non-positive target", () => {
    const mesh = new Mesh(new BoxGeometry(0.5, 0.1, 3), new MeshBasicMaterial());
    fitSkateboard(mesh, false, 0);
    const size = new Box3().setFromObject(mesh).getSize(new Vector3());
    expect(size.z).toBeCloseTo(BOARD_TARGET_LENGTH, 3);
  });
});

describe("placeDeckGraphic", () => {
  it("leaves the graphic alone on an empty board", () => {
    const graphic = new Group();
    placeDeckGraphic(new Group(), graphic);
    expect(graphic.position.toArray()).toEqual([0, 0, 0]);
    expect(graphic.rotation.x).toBe(0);
  });
});

describe("loadRunnerModel", () => {
  it("wires Draco, KTX2 and Meshopt, tunes color spaces and anisotropy, and frees the decoders", async () => {
    const { model, texture } = boardModel();
    const normal = new Texture();
    const emissive = new Texture();
    const twoMaterials = new Mesh(new BoxGeometry(), [
      new MeshStandardMaterial({ normalMap: normal, emissiveMap: emissive }),
      new MeshBasicMaterial({ map: new Texture() }),
    ]);
    model.add(twoMaterials);
    gltf.next = () => Promise.resolve({ scene: model });
    const gl = fakeRenderer(false, 16);

    const scene = await loadRunnerModel("board.glb", asRenderer(gl));
    expect(scene).toBe(model);
    expect(gltf.urls).toEqual(["board.glb"]);
    expect(gltf.draco[0]?.path).toBe("/runner/decoders/draco/");
    expect(gltf.ktx2[0]?.path).toBe("/runner/decoders/basis/");
    expect(gltf.ktx2[0]?.support).toBe(gl);
    expect((gltf.wiring[0]?.meshopt as { name: string }).name).toBe("meshopt");
    expect(gltf.draco[0]?.disposed).toBe(true);
    expect(gltf.ktx2[0]?.disposed).toBe(true);

    expect(texture.colorSpace).toBe(SRGBColorSpace);
    expect(emissive.colorSpace).toBe(SRGBColorSpace);
    expect(normal.colorSpace).toBe(NoColorSpace);
    // Capped at 4 even when the GPU allows 16.
    expect(texture.anisotropy).toBe(4);
    expect(normal.anisotropy).toBe(4);
  });

  it("uses a lower GPU anisotropy cap as is", async () => {
    const { model, texture } = boardModel();
    gltf.next = () => Promise.resolve({ scene: model });
    await loadRunnerModel("board.glb", asRenderer(fakeRenderer(false, 2)));
    expect(texture.anisotropy).toBe(2);
  });

  it("warns and still loads when the KTX2 support check throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    gltf.detectError = new Error("no webgl");
    gltf.next = () => Promise.resolve({ scene: boardModel().model });
    await expect(loadRunnerModel("board.glb", asRenderer(fakeRenderer()))).resolves.toBeInstanceOf(Group);
    expect(warn).toHaveBeenCalledWith("Runner KTX2 support check failed", gltf.detectError);
  });

  it("frees the decoders when the file fails", async () => {
    gltf.next = () => Promise.reject(new Error("404"));
    await expect(loadRunnerModel("board.glb", asRenderer(fakeRenderer()))).rejects.toThrow("404");
    expect(gltf.draco[0]?.disposed).toBe(true);
    expect(gltf.ktx2[0]?.disposed).toBe(true);
  });
});

function ModelHook({ root, controller }: { root: RefObject<Group | null>; controller: RunnerController }) {
  const gl = useThree((state) => state.gl);
  useSkateboardModel(root, gl, controller);
  return null;
}

/**
 * The hook lives in a sibling so a test can drop it while the rig stays
 * mounted, which is when its cleanup can still find Graphic and ProceduralBoard.
 */
function Rig({
  controller,
  mounted = true,
  parts = true,
  hooked = true,
}: {
  controller: RunnerController;
  mounted?: boolean;
  parts?: boolean;
  hooked?: boolean;
}) {
  const root = useRef<Group>(null);
  return (
    <>
      <group ref={mounted ? root : undefined} name="Rig">
        {parts ? (
          <>
            <group name="ProceduralBoard" />
            <mesh name="Graphic" visible={false} />
          </>
        ) : null}
      </group>
      {hooked ? <ModelHook root={root} controller={controller} /> : null}
    </>
  );
}

describe("useSkateboardModel", () => {
  let scene: Scene3D | null = null;
  let pending: Deferred<{ scene: unknown }>;

  beforeEach(() => {
    pending = deferred();
    gltf.next = () => pending.promise;
  });

  afterEach(async () => {
    await scene?.unmount();
    scene = null;
  });

  async function land(model: Object3D): Promise<void> {
    pending.resolve({ scene: model });
    await vi.waitFor(() => expect(model.parent).not.toBeNull());
  }

  it("fetches nothing with an empty slot or before the rig mounts", async () => {
    scene = await render3D(<Rig controller={fakeController()} />);
    await scene.unmount();
    slots.skateboard = "board.glb";
    scene = await render3D(<Rig controller={fakeController()} mounted={false} />);
    expect(gltf.urls).toEqual([]);
  });

  it("swaps the procedural deck for Skateboard_01, sits the graphic under it, and rolls the wheels", async () => {
    slots.skateboard = "board.glb";
    const controller = fakeController({ speed: 10 } as never);
    scene = await render3D(<Rig controller={controller} />, { shadows: true });
    // No wheels yet: frames are a no-op.
    await scene.frame(0.1);

    const { model, deckGeometry, texture } = boardModel();
    await land(model);
    const rig = scene.find("Rig");
    expect(model.parent).toBe(rig);
    expect(model.name).toBe("Skateboard01");
    expect(new Box3().setFromObject(model).getSize(new Vector3()).z).toBeCloseTo(BOARD_TARGET_LENGTH, 3);
    expect(scene.find("ProceduralBoard").visible).toBe(false);
    const graphic = scene.find("Graphic");
    expect(graphic.visible).toBe(true);
    expect(graphic.scale.x).not.toBeCloseTo(0.48);
    let allShadowed = true;
    model.traverse((obj) => {
      if (obj instanceof Mesh && !(obj.castShadow && obj.receiveShadow)) allShadowed = false;
    });
    expect(allShadowed).toBe(true);

    const wheel = model.getObjectByName("Wheel_-0.7") as Object3D;
    await scene.frame(0.1);
    expect(wheel.rotation.x).toBeCloseTo(10 * 0.1 * 1.7);
    controller.state.duck = 0;
    await scene.frame(0.1);
    expect(wheel.rotation.x).toBeCloseTo(10 * 0.1 * (1.7 + 0.35));

    const geometryDispose = vi.spyOn(deckGeometry, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    await scene.rerender(<Rig controller={controller} hooked={false} />);
    expect(model.parent).toBeNull();
    expect(geometryDispose).toHaveBeenCalled();
    expect(textureDispose).toHaveBeenCalled();
    expect(scene.find("ProceduralBoard").visible).toBe(true);
    // The logo plane goes back under the procedural deck.
    expect(graphic.position.toArray()).toEqual([0, 0.222, 0]);
    expect(graphic.rotation.x).toBeCloseTo(Math.PI / 2);
    expect(graphic.scale.toArray()).toEqual([0.48, 0.92, 1]);
    // The wheel list is gone with the model: later frames do not touch it.
    const spun = wheel.rotation.x;
    await scene.frame(0.1);
    expect(wheel.rotation.x).toBe(spun);
  });

  it("skips shadows, the graphic and the procedural deck when the rig lacks them", async () => {
    slots.skateboard = "board.glb";
    scene = await render3D(<Rig controller={fakeController()} parts={false} />);
    const { model } = boardModel();
    await land(model);
    let shadowed = false;
    model.traverse((obj) => {
      if (obj instanceof Mesh && obj.castShadow) shadowed = true;
    });
    expect(shadowed).toBe(false);
    await scene.rerender(<Rig controller={fakeController()} parts={false} hooked={false} />);
    expect(model.parent).toBeNull();
  });

  it("disposes a model that lands after unmount", async () => {
    slots.skateboard = "board.glb";
    scene = await render3D(<Rig controller={fakeController()} />);
    const procedural = scene.find("ProceduralBoard");
    await scene.unmount();
    scene = null;
    const { model, deckGeometry } = boardModel();
    const dispose = vi.spyOn(deckGeometry, "dispose");
    pending.resolve({ scene: model });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalled());
    expect(model.parent).toBeNull();
    expect(procedural.visible).toBe(true);
  });

  it("frees every material in a multi-material mesh, mapped or not", async () => {
    slots.skateboard = "board.glb";
    scene = await render3D(<Rig controller={fakeController()} />);
    await scene.unmount();
    scene = null;
    const texture = new Texture();
    const plain = new MeshBasicMaterial();
    const mapped = new MeshStandardMaterial({ map: texture });
    const model = new Group();
    model.add(new Mesh(new BoxGeometry(2, 0.1, 0.5), [plain, mapped]));
    const spies = [plain, mapped, texture].map((item) => vi.spyOn(item, "dispose"));
    pending.resolve({ scene: model });
    await vi.waitFor(() => expect(spies[2]).toHaveBeenCalled());
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("warns and keeps the procedural deck when the model fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    slots.skateboard = "board.glb";
    scene = await render3D(<Rig controller={fakeController()} />);
    const error = new Error("bad glb");
    pending.reject(error);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("Runner skateboard model failed to load", error));
    expect(scene.find("ProceduralBoard").visible).toBe(true);
  });
});

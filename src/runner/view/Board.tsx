import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Group as ThreeGroup } from "three";
import { mikeWhiteBoardUrl } from "../artSlots";
import type { RunnerController } from "../controller";
import type { RunnerQuality } from "../quality";
import { useCustomBoardArt } from "./customArt";
import { useSkateboardModel, wheelSpinRate } from "./skateboardModel";
import { deckMaterial, flatMaterial, gripMaterial, truckMaterial } from "./textures";

const wood = deckMaterial();
const ply = flatMaterial("#6e4528");
const graphic = flatMaterial("#f3efe6");
graphic.side = DoubleSide;
graphic.polygonOffset = true;
graphic.polygonOffsetFactor = -2;
graphic.polygonOffsetUnits = -2;
const logo = flatMaterial("#f3efe6");
logo.side = DoubleSide;
const truck = truckMaterial();
const hanger = truckMaterial();
const wheel = new MeshBasicMaterial({ color: "#f4f4f4" });
const hub = new MeshBasicMaterial({ color: "#141414" });
const bolt = flatMaterial("#8d949a");

const wheelGeo = new CylinderGeometry(0.14, 0.14, 0.12, 12);
wheelGeo.rotateZ(Math.PI / 2);
const axleGeo = new CylinderGeometry(0.03, 0.03, 0.92, 6);
axleGeo.rotateZ(Math.PI / 2);

/**
 * The player. Deck, griptape, trucks, and four wheels — no body.
 * Wheels sit outside the deck so a high three-quarter camera shows them.
 * Poses come from the interpolated sim frame. This component only applies them.
 */
export function Board({ controller, quality }: { controller: RunnerController; quality: RunnerQuality }) {
  const root = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const wheels = useRef<(Group | null)[]>([]);
  const gl = useThree((state) => state.gl);
  useSkateboardModel(root, gl, controller);
  useCustomBoardArt(root);

  useLayoutEffect(() => {
    const group = root.current;
    if (!group || quality !== "high") return;
    group.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [quality]);

  useFrame((_, dt) => {
    const state = controller.getState();
    const frame = controller.getRenderFrame();
    const group = root.current;
    if (group) {
      const squash = frame.squash;
      const scale = 1.4;
      group.position.set(frame.x, frame.y - squash * 0.05, 0);
      group.scale.set(scale * (1 + squash * 0.4), scale * (1 - squash), scale * (1 + squash * 0.16));
      group.rotation.set(frame.pitch, frame.yaw, frame.roll + frame.spin * Math.PI * 2);
    }
    if (shadow.current) {
      shadow.current.position.x = frame.x;
      shadow.current.visible = state.status !== "gameover";
    }
    const next = (wheels.current[0]?.rotation.x ?? 0) + frame.speed * dt * wheelSpinRate(state);
    for (const mesh of wheels.current) {
      if (mesh) mesh.rotation.x = next;
    }
  });

  const wheelName = (index: number, x: number): string => {
    if (index < 2) return x < 0 ? "WheelNoseLeft" : "WheelNoseRight";
    return x < 0 ? "WheelTailLeft" : "WheelTailRight";
  };

  const wheelAt = (index: number, x: number, z: number) => (
    <group
      key={`${x}:${z}`}
      ref={(node: ThreeGroup | null) => {
        wheels.current[index] = node;
      }}
      position={[x, 0.15, z]}
      name={wheelName(index, x)}
    >
      <mesh geometry={wheelGeo} material={wheel} />
      <mesh geometry={wheelGeo} material={hub} scale={[0.42, 1.05, 0.42]} />
    </group>
  );

  const truckAt = (name: string, z: number) => (
    <group position={[0, 0, z]}>
      <mesh name={name} position={[0, 0.22, 0]} material={truck}>
        <boxGeometry args={[0.16, 0.04, 0.14]} />
      </mesh>
      <mesh position={[0, 0.17, 0]} material={hanger}>
        <boxGeometry args={[0.28, 0.045, 0.09]} />
      </mesh>
      <mesh position={[0, 0.145, 0]} geometry={axleGeo} material={bolt} />
    </group>
  );

  return (
    <group>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={[0.85, 1.35, 1]}>
        <circleGeometry args={[0.48, 16]} />
        <meshBasicMaterial color="#140e0a" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <group ref={root} name="BoardRig" userData={{ mikeWhiteBoard: mikeWhiteBoardUrl() }}>
        <group name="ProceduralBoard">
          <mesh name="DeckPly" position={[0, 0.236, 0]} material={ply}>
            <boxGeometry args={[0.6, 0.012, 1.32]} />
          </mesh>
          <mesh name="Deck" position={[0, 0.26, 0]} material={wood}>
            <boxGeometry args={[0.58, 0.04, 1.28]} />
          </mesh>
          <mesh name="DeckNose" position={[0, 0.32, -0.78]} rotation={[0.42, 0, 0]} material={wood}>
            <boxGeometry args={[0.58, 0.03, 0.36]} />
          </mesh>
          <mesh name="DeckTail" position={[0, 0.32, 0.78]} rotation={[-0.36, 0, 0]} material={wood}>
            <boxGeometry args={[0.58, 0.03, 0.32]} />
          </mesh>
          <mesh name="Griptape" position={[0, 0.292, 0]} material={gripMaterial()}>
            <boxGeometry args={[0.56, 0.018, 1.2]} />
          </mesh>
          <mesh position={[0, 0.348, -0.78]} rotation={[0.42, 0, 0]} material={gripMaterial()}>
            <boxGeometry args={[0.52, 0.012, 0.28]} />
          </mesh>
          <mesh position={[0, 0.348, 0.78]} rotation={[-0.36, 0, 0]} material={gripMaterial()}>
            <boxGeometry args={[0.52, 0.012, 0.24]} />
          </mesh>
          <mesh
            name="LogoDecal"
            position={[0, 0.31, -0.28]}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
            material={logo}
          >
            <planeGeometry args={[0.14, 0.14]} />
          </mesh>
          {truckAt("TruckNose", -0.46)}
          {truckAt("TruckTail", 0.46)}
          {wheelAt(0, -0.38, -0.46)}
          {wheelAt(1, 0.38, -0.46)}
          {wheelAt(2, -0.38, 0.46)}
          {wheelAt(3, 0.38, 0.46)}
        </group>
        <mesh
          name="Graphic"
          position={[0, 0.222, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[0.48, 0.92, 1]}
          material={graphic}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      </group>
    </group>
  );
}

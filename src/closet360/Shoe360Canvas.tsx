/**
 * Three.js scene for the 360 shoe viewer. Lazy-loaded by components/Shoe360
 * so the 3D engine never lands on first paint. Camera orbits (drag to spin,
 * gentle auto-rotate) around a still shoe, so the contact shadow renders once.
 */
import { useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls, useTexture } from "@react-three/drei";
import { BufferAttribute, BufferGeometry, SRGBColorSpace } from "three";
import { buildShoeLoft, type ShoeSkin } from "../lib/closet/shoe360";

function Shoe({ skin }: { skin: ShoeSkin }) {
  const texture = useTexture(skin.textureUrl, (t) => {
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
  });
  const geometry = useMemo(() => {
    const loft = buildShoeLoft(skin.profile);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(loft.positions, 3));
    g.setAttribute("uv", new BufferAttribute(loft.uvs, 2));
    g.setIndex(new BufferAttribute(loft.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [skin]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial map={texture} roughness={0.62} metalness={0.04} />
    </mesh>
  );
}

export interface Shoe360CanvasProps {
  skin: ShoeSkin;
  autoRotate: boolean;
  active: boolean;
}

export default function Shoe360Canvas({ skin, autoRotate, active }: Shoe360CanvasProps) {
  const target = skin.profile.aspect * 0.4;
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [1.0, 0.6, 2.35], fov: 30 }}
      gl={{ antialias: true, powerPreference: "low-power", preserveDrawingBuffer: true }}
      data-testid="shoe360-canvas"
    >
      <hemisphereLight args={["#ffffff", "#2a2a30", 0.9]} />
      <directionalLight position={[2, 3, 2]} intensity={1.6} />
      <directionalLight position={[-2, 1.2, -1.5]} intensity={0.7} color="#ffd7b0" />
      <Shoe skin={skin} />
      <ContactShadows
        position={[0, -0.002, 0]}
        scale={1.8}
        blur={2.6}
        far={0.6}
        opacity={0.6}
        resolution={256}
        frames={1}
      />
      <OrbitControls
        target={[0, target, 0]}
        enablePan={false}
        enableZoom={false}
        enableDamping
        autoRotate={autoRotate}
        autoRotateSpeed={1.4}
        minPolarAngle={0.7}
        maxPolarAngle={1.5}
      />
    </Canvas>
  );
}

import { AdditiveBlending, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { graffPosterMaterial, hubbaPosterMaterial, logoPosterMaterial, shopSignMaterial } from "./brandArt";
import { PALETTE, alleyPaletteMaterial, paletteBox, paletteCylinder } from "./palette";
import { brickBuildingMaterial } from "./textures";

const alleyMat = alleyPaletteMaterial();
const lampHeadMat = new MeshStandardMaterial({
  color: "#4a3014",
  emissive: "#ffb020",
  emissiveIntensity: 1.6,
  roughness: 0.35,
});
const glowMat = new MeshBasicMaterial({
  color: "#ffb23a",
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
const poolMat = new MeshBasicMaterial({
  color: "#ff8a1e",
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
const doorMat = new MeshStandardMaterial({
  color: "#3a2412",
  emissive: "#ff9a3c",
  emissiveIntensity: 0.85,
  roughness: 0.45,
});
const glassMat = new MeshStandardMaterial({
  color: "#1a120c",
  emissive: "#ffb060",
  emissiveIntensity: 0.35,
  roughness: 0.18,
});

/**
 * Sodium lamps, a dumpster, graffiti posters, and the HubbaSpot shop.
 * Parent these to a recycled street slab. Glow is an additive card. The
 * high tier adds a short bloom pass on top of that card. The phone tier
 * keeps the card and skips the pass.
 */
export function AlleyProps({ index, high }: { index: number; high: boolean }) {
  return (
    <group>
      <Lamp position={[-3.2, -15]} high={high} />
      <Lamp position={[3.2, 11]} high={high} />
      {index === 0 ? <Shop high={high} /> : null}
      {index === 1 ? <Dumpster position={[-3.55, 14]} high={high} /> : null}
      {index === 2 ? <Dumpster position={[3.55, -14]} high={high} /> : null}
      {index === 0 ? (
        <mesh position={[-4.9, 1.2, 12]} rotation={[0, Math.PI / 2, 0]} material={graffPosterMaterial()}>
          <planeGeometry args={[1.55, 2.05]} />
        </mesh>
      ) : null}
      {index === 1 ? (
        <mesh position={[4.9, 1.2, -8]} rotation={[0, -Math.PI / 2, 0]} material={hubbaPosterMaterial()}>
          <planeGeometry args={[1.55, 2.05]} />
        </mesh>
      ) : null}
      {index === 2 ? (
        <mesh position={[-4.9, 1.35, 6]} rotation={[0, Math.PI / 2, 0]} material={logoPosterMaterial()}>
          <planeGeometry args={[1.35, 1.35]} />
        </mesh>
      ) : null}
    </group>
  );
}

function Lamp({ position, high }: { position: readonly [number, number]; high: boolean }) {
  const [x, z] = position;
  return (
    <group position={[x, 0, z]}>
      <mesh
        position={[0, 1.55, 0]}
        material={alleyMat}
        geometry={paletteCylinder(0.045, 0.06, 3.1, PALETTE.pole)}
        castShadow={high}
      />
      <mesh position={[0, 3.12, 0]} material={lampHeadMat}>
        <boxGeometry args={[0.22, 0.1, 0.62]} />
      </mesh>
      <mesh position={[0, 3.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glowMat}>
        <circleGeometry args={[0.42, 12]} />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} material={poolMat}>
        <circleGeometry args={[0.85, 16]} />
      </mesh>
    </group>
  );
}

function Dumpster({ position, high }: { position: readonly [number, number]; high: boolean }) {
  const [x, z] = position;
  return (
    <group position={[x, 0, z]}>
      <mesh
        position={[0, 0.42, 0]}
        material={alleyMat}
        geometry={paletteBox(0.9, 0.84, 1.25, PALETTE.dumpster)}
        castShadow={high}
        receiveShadow={high}
      />
      <mesh
        position={[0, 0.9, -0.08]}
        rotation={[0.35, 0, 0]}
        material={alleyMat}
        geometry={paletteBox(0.94, 0.08, 1.15, PALETTE.lid)}
        castShadow={high}
      />
    </group>
  );
}

function Shop({ high }: { high: boolean }) {
  return (
    <group position={[4.65, 0, 0]}>
      <mesh position={[0.05, 1.7, 0]} material={brickBuildingMaterial()} castShadow={high} receiveShadow={high}>
        <boxGeometry args={[0.4, 3.4, 4.2]} />
      </mesh>
      <mesh
        position={[-0.42, 2.55, 0]}
        material={alleyMat}
        geometry={paletteBox(0.85, 0.12, 3.6, PALETTE.awning)}
        castShadow={high}
      />
      <mesh position={[-0.42, 2.46, 0]} material={alleyMat} geometry={paletteBox(0.86, 0.05, 3.62, PALETTE.stripe)} />
      <mesh position={[-0.2, 0.95, 0.15]} material={doorMat}>
        <boxGeometry args={[0.08, 1.7, 0.95]} />
      </mesh>
      <mesh position={[-0.2, 1.7, -1.15]} material={glassMat}>
        <boxGeometry args={[0.06, 0.7, 0.7]} />
      </mesh>
      <mesh position={[-0.2, 1.7, 1.25]} material={glassMat}>
        <boxGeometry args={[0.06, 0.7, 0.7]} />
      </mesh>
      <mesh position={[-0.86, 2.52, 0]} rotation={[0, -Math.PI / 2, 0]} material={shopSignMaterial()}>
        <planeGeometry args={[3.3, 0.9]} />
      </mesh>
      <mesh position={[-0.2, 1.55, -1.7]} rotation={[0, -Math.PI / 2, 0]} material={logoPosterMaterial()}>
        <planeGeometry args={[0.7, 0.7]} />
      </mesh>
    </group>
  );
}

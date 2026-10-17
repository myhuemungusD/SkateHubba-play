import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BoxGeometry, InstancedMesh, Object3D, PlaneGeometry, type MeshStandardMaterial } from "three";
import { SEGMENT_LENGTH } from "../constants";
import type { RunnerController } from "../controller";
import type { RunnerQuality } from "../quality";
import { brickMaterial, flatMaterial, roadMaterial, sidewalkMaterial } from "./textures";

const SLABS = 3;
const curbMat = flatMaterial("#5e5954");
const dashMat = flatMaterial("#d8d2c4");
const DASH_Z = [-12, -4, 4, 12] as const;

function slabZ(distance: number, slot: number): number {
  const index = Math.floor(distance / SEGMENT_LENGTH);
  const center = (index - 1 + slot) * SEGMENT_LENGTH + SEGMENT_LENGTH / 2;
  return -(center - distance);
}

/**
 * One draw call each for the road, sidewalks, curbs, brick walls, and lane
 * dashes. The slabs still recycle; the instance matrices move with them.
 */
export function GroundInstances({ controller, quality }: { controller: RunnerController; quality: RunnerQuality }) {
  const high = quality === "high";
  const road = useRef<InstancedMesh>(null);
  const sidewalk = useRef<InstancedMesh>(null);
  const curb = useRef<InstancedMesh>(null);
  const wall = useRef<InstancedMesh>(null);
  const dash = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const roadGeo = useMemo(() => new PlaneGeometry(5.4, SEGMENT_LENGTH), []);
  const walkGeo = useMemo(() => new PlaneGeometry(2.1, SEGMENT_LENGTH), []);
  const curbGeo = useMemo(() => new BoxGeometry(0.16, 0.1, SEGMENT_LENGTH), []);
  const wallGeo = useMemo(() => new BoxGeometry(0.35, 2.3, SEGMENT_LENGTH), []);
  const dashGeo = useMemo(() => new BoxGeometry(0.08, 0.02, 1.4), []);
  const roadArgs = useMemo(
    () => [roadGeo, roadMaterial(), SLABS] as [PlaneGeometry, MeshStandardMaterial, number],
    [roadGeo],
  );
  const walkArgs = useMemo(
    () => [walkGeo, sidewalkMaterial(), SLABS * 2] as [PlaneGeometry, MeshStandardMaterial, number],
    [walkGeo],
  );
  const curbArgs = useMemo(
    () => [curbGeo, curbMat, SLABS * 2] as [BoxGeometry, MeshStandardMaterial, number],
    [curbGeo],
  );
  const wallArgs = useMemo(
    () => [wallGeo, brickMaterial(), SLABS * 2] as [BoxGeometry, MeshStandardMaterial, number],
    [wallGeo],
  );
  const dashArgs = useMemo(
    () => [dashGeo, dashMat, SLABS * DASH_Z.length] as [BoxGeometry, MeshStandardMaterial, number],
    [dashGeo],
  );

  useEffect(() => {
    return () => {
      roadGeo.dispose();
      walkGeo.dispose();
      curbGeo.dispose();
      wallGeo.dispose();
      dashGeo.dispose();
    };
  }, [curbGeo, dashGeo, roadGeo, walkGeo, wallGeo]);

  useFrame(() => {
    const distance = controller.getRenderFrame().distance;
    const roadMesh = road.current;
    const walkMesh = sidewalk.current;
    const curbMesh = curb.current;
    const wallMesh = wall.current;
    const dashMesh = dash.current;
    if (!roadMesh || !walkMesh || !curbMesh || !wallMesh || !dashMesh) return;

    for (let slot = 0; slot < SLABS; slot += 1) {
      const z = slabZ(distance, slot);
      dummy.position.set(0, 0, z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      roadMesh.setMatrixAt(slot, dummy.matrix);

      dummy.position.set(-3.7, 0.06, z);
      dummy.updateMatrix();
      walkMesh.setMatrixAt(slot, dummy.matrix);
      dummy.position.set(3.7, 0.06, z);
      dummy.updateMatrix();
      walkMesh.setMatrixAt(SLABS + slot, dummy.matrix);

      dummy.rotation.set(0, 0, 0);
      dummy.position.set(-2.55, 0.05, z);
      dummy.updateMatrix();
      curbMesh.setMatrixAt(slot, dummy.matrix);
      dummy.position.set(2.55, 0.05, z);
      dummy.updateMatrix();
      curbMesh.setMatrixAt(SLABS + slot, dummy.matrix);

      dummy.position.set(-5.15, 1.15, z);
      dummy.updateMatrix();
      wallMesh.setMatrixAt(slot, dummy.matrix);
      dummy.position.set(5.15, 1.15, z);
      dummy.updateMatrix();
      wallMesh.setMatrixAt(SLABS + slot, dummy.matrix);

      for (let mark = 0; mark < DASH_Z.length; mark += 1) {
        dummy.position.set(0, 0.015, z + (DASH_Z[mark] ?? 0));
        dummy.updateMatrix();
        dashMesh.setMatrixAt(slot * DASH_Z.length + mark, dummy.matrix);
      }
    }

    roadMesh.instanceMatrix.needsUpdate = true;
    walkMesh.instanceMatrix.needsUpdate = true;
    curbMesh.instanceMatrix.needsUpdate = true;
    wallMesh.instanceMatrix.needsUpdate = true;
    dashMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={road} args={roadArgs} receiveShadow={high} frustumCulled={false} />
      <instancedMesh ref={sidewalk} args={walkArgs} receiveShadow={high} frustumCulled={false} />
      <instancedMesh ref={curb} args={curbArgs} frustumCulled={false} />
      <instancedMesh ref={wall} args={wallArgs} receiveShadow={high} frustumCulled={false} />
      <instancedMesh ref={dash} args={dashArgs} frustumCulled={false} />
    </group>
  );
}

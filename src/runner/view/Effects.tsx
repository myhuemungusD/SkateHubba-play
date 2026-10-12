import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BoxGeometry, InstancedMesh, MeshBasicMaterial, Object3D, OctahedronGeometry } from "three";
import type { RunnerController } from "../controller";
import { shouldPuffDust, speedLineOpacity } from "../juice";

const SPARKS = 12;
const DUST = 8;
const LINES = 6;

interface Spark {
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function resetSpark(spark: Spark, x: number, seed: number): void {
  const angle = seed * 6.1;
  spark.life = 0.22 + (seed % 1) * 0.18;
  spark.x = x + Math.sin(angle) * 0.04;
  spark.y = 0.32;
  spark.z = 0.12;
  spark.vx = Math.sin(angle) * 1.8;
  spark.vy = 1.6 + (seed % 0.5);
  spark.vz = 0.55 + Math.cos(angle) * 0.8;
}

function resetDust(dust: Spark, x: number, seed: number): void {
  const angle = seed * 4.3;
  dust.life = 0.28 + (seed % 1) * 0.2;
  dust.x = x + Math.sin(angle) * 0.22;
  dust.y = 0.05;
  dust.z = 0.04;
  dust.vx = Math.sin(angle) * 0.65;
  dust.vy = 0.5 + (seed % 0.25);
  dust.vz = Math.cos(angle) * 0.3;
}

function place(
  mesh: InstancedMesh,
  dummy: Object3D,
  index: number,
  life: number,
  x: number,
  y: number,
  z: number,
): void {
  if (life <= 0) {
    dummy.scale.set(0, 0, 0);
    dummy.position.set(0, 0, 0);
  } else {
    const size = Math.min(1, life * 4);
    dummy.scale.set(size, size, size);
    dummy.position.set(x, y, z);
  }
  dummy.rotation.set(0, 0, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

/**
 * Speed lines, grind sparks, and a landing puff. One instanced draw call
 * each. Nothing is allocated while the run is moving. All three stay
 * hidden when the player asked for reduced motion.
 */
export function Effects({ controller, reducedMotion }: { controller: RunnerController; reducedMotion: boolean }) {
  const sparks = useRef<Spark[]>(
    Array.from({ length: SPARKS }, (_, index) => {
      const spark: Spark = { life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
      resetSpark(spark, 0, index + 1);
      return spark;
    }),
  );
  const dust = useRef<Spark[]>(
    Array.from({ length: DUST }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 })),
  );
  const sparkMesh = useRef<InstancedMesh>(null);
  const dustMesh = useRef<InstancedMesh>(null);
  const lineMesh = useRef<InstancedMesh>(null);
  const wasGrind = useRef(false);
  const dummy = useMemo(() => new Object3D(), []);
  const sparkGeo = useMemo(() => new OctahedronGeometry(0.045, 0), []);
  const dustGeo = useMemo(() => new OctahedronGeometry(0.045, 0), []);
  const lineGeo = useMemo(() => new BoxGeometry(0.012, 0.012, 1), []);
  const sparkMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: "#ffe1a8",
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const dustMat = useMemo(
    () => new MeshBasicMaterial({ color: "#cbb79a", transparent: true, opacity: 0.4, depthWrite: false }),
    [],
  );
  const lineMat = useMemo(
    () => new MeshBasicMaterial({ color: "#f3e2b0", transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  const sparkArgs = useMemo(
    () => [sparkGeo, sparkMat, SPARKS] as [OctahedronGeometry, MeshBasicMaterial, number],
    [sparkGeo, sparkMat],
  );
  const dustArgs = useMemo(
    () => [dustGeo, dustMat, DUST] as [OctahedronGeometry, MeshBasicMaterial, number],
    [dustGeo, dustMat],
  );
  const lineArgs = useMemo(
    () => [lineGeo, lineMat, LINES] as [BoxGeometry, MeshBasicMaterial, number],
    [lineGeo, lineMat],
  );

  useEffect(() => {
    return () => {
      sparkGeo.dispose();
      dustGeo.dispose();
      lineGeo.dispose();
      sparkMat.dispose();
      dustMat.dispose();
      lineMat.dispose();
    };
  }, [dustGeo, dustMat, lineGeo, lineMat, sparkGeo, sparkMat]);

  useFrame((_, dt) => {
    const state = controller.getState();
    const frame = controller.getRenderFrame();
    const playing = state.status === "playing";
    const grinding = state.onGrind || state.duck >= 0;
    const emit = grinding && playing && !reducedMotion;
    const sparksDraw = sparkMesh.current;
    const dustDraw = dustMesh.current;
    const linesDraw = lineMesh.current;
    if (!sparksDraw || !dustDraw || !linesDraw) return;

    for (let i = 0; i < SPARKS; i += 1) {
      const spark = sparks.current[i];
      if (!spark) continue;
      spark.life -= dt;
      if (spark.life <= 0 && emit) resetSpark(spark, frame.x, frame.distance * 0.17 + i * 0.37);
      if (spark.life > 0) {
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        spark.z += spark.vz * dt;
        spark.vy -= dt * 3.2;
      }
      place(sparksDraw, dummy, i, emit || spark.life > 0 ? spark.life : 0, spark.x, spark.y, spark.z);
    }
    sparksDraw.instanceMatrix.needsUpdate = true;

    const puff = shouldPuffDust(wasGrind.current, state.onGrind, reducedMotion, playing);
    wasGrind.current = state.onGrind;
    let dustPeak = 0;
    for (let i = 0; i < DUST; i += 1) {
      const mote = dust.current[i];
      if (!mote) continue;
      if (reducedMotion) mote.life = 0;
      if (puff) resetDust(mote, frame.x, frame.distance * 0.13 + i * 0.41);
      mote.life -= dt;
      if (mote.life > 0) {
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        mote.z += mote.vz * dt;
        mote.vy -= dt * 1.4;
        dustPeak = Math.max(dustPeak, mote.life);
      }
      place(dustDraw, dummy, i, Math.max(0, mote.life), mote.x, Math.max(0.04, mote.y), mote.z);
    }
    if (dustDraw.material instanceof MeshBasicMaterial) dustDraw.material.opacity = Math.min(0.45, dustPeak);
    dustDraw.instanceMatrix.needsUpdate = true;

    const opacity = speedLineOpacity(frame.speed, reducedMotion, playing);
    if (linesDraw.material instanceof MeshBasicMaterial) linesDraw.material.opacity = opacity;
    for (let i = 0; i < LINES; i += 1) {
      const length = 0.7 + i * 0.18;
      dummy.position.set(frame.x + (i - 2.5) * 0.2, 0.35 + (i % 2) * 0.18, 1.2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(opacity > 0 ? 1 : 0, opacity > 0 ? 1 : 0, opacity > 0 ? length : 0);
      dummy.updateMatrix();
      linesDraw.setMatrixAt(i, dummy.matrix);
    }
    linesDraw.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={sparkMesh} args={sparkArgs} frustumCulled={false} />
      <instancedMesh ref={dustMesh} args={dustArgs} frustumCulled={false} />
      <instancedMesh ref={lineMesh} args={lineArgs} frustumCulled={false} />
    </group>
  );
}

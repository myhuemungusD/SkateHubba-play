import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { AnimationAction, Group, Mesh } from "three";
import { SkeletonUtils } from "three-stdlib";
import { useAnimations } from "@react-three/drei/core/useAnimations";
import { useGLTF } from "@react-three/drei/core/Gltf";
import type { RunnerController } from "../controller";
import {
  SKATER_CLIPS,
  SKATER_GLTF_SCALE,
  SKATER_GLTF_URL,
  clipForPose,
  poseFromState,
  type SkaterPose,
} from "../skaterRig";

/**
 * Placeholder body. Replaced wholesale when `SKATER_GLTF_URL` points at a file
 * that follows the clip and bone names in `skaterRig.ts`.
 */
function PlaceholderSkater({ controller }: { controller: RunnerController }) {
  const root = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const board = useRef<Group>(null);

  useFrame(() => {
    const state = controller.getState();
    const pose = poseFromState(state);
    const group = root.current;
    if (!group) return;
    group.position.set(state.x, state.y, 0);
    group.rotation.z = pose === "bail" ? 0.9 : 0;
    if (body.current) {
      const ducked = pose === "duck";
      body.current.scale.y = ducked ? 0.55 : 1;
      body.current.position.y = ducked ? 0.72 : 0.98;
    }
    if (board.current) {
      board.current.rotation.x = pose === "ollie" ? -0.4 : 0.08;
      board.current.rotation.z = pose === "boardslide" ? 0.55 : 0;
    }
  });

  return (
    <group ref={root}>
      <group ref={board} position={[0, 0.12, 0]}>
        <mesh castShadow={false}>
          <boxGeometry args={[0.28, 0.05, 0.9]} />
          <meshLambertMaterial color="#1a1a1a" />
        </mesh>
        <mesh position={[0, -0.04, 0.28]}>
          <boxGeometry args={[0.32, 0.03, 0.08]} />
          <meshLambertMaterial color="#9a9a9a" />
        </mesh>
        <mesh position={[0, -0.04, -0.28]}>
          <boxGeometry args={[0.32, 0.03, 0.08]} />
          <meshLambertMaterial color="#9a9a9a" />
        </mesh>
      </group>
      <mesh ref={body} position={[0, 0.98, 0]} castShadow={false}>
        <boxGeometry args={[0.38, 0.7, 0.22]} />
        <meshLambertMaterial color="#ff6b00" />
      </mesh>
      <mesh position={[0, 1.5, -0.02]}>
        <sphereGeometry args={[0.16, 8, 6]} />
        <meshLambertMaterial color="#f2d3b0" />
      </mesh>
      <mesh position={[0, 1.5, -0.16]}>
        <boxGeometry args={[0.06, 0.06, 0.08]} />
        <meshLambertMaterial color="#222" />
      </mesh>
    </group>
  );
}

function clipAction(
  actions: Record<string, AnimationAction | null | undefined>,
  pose: SkaterPose,
): AnimationAction | null {
  return actions[clipForPose(pose)] ?? null;
}

function SkaterGltf({ controller, url }: { controller: RunnerController; url: string }) {
  const gltf = useGLTF(url);
  const cloned = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  const root = useRef<Group>(null);
  const { actions } = useAnimations(gltf.animations, root);
  const poseRef = useRef<SkaterPose>("ride");
  const named = actions as Record<string, AnimationAction | null | undefined>;

  useEffect(() => {
    named[SKATER_CLIPS.push]?.reset().play();
  }, [named]);

  useFrame(() => {
    const state = controller.getState();
    const pose = poseFromState(state);
    root.current?.position.set(state.x, state.y, 0);
    root.current?.scale.setScalar(SKATER_GLTF_SCALE);
    if (pose === poseRef.current) return;
    clipAction(named, poseRef.current)?.fadeOut(0.12);
    const next = clipAction(named, pose);
    next?.reset().fadeIn(0.12).play();
    poseRef.current = pose;
  });

  return <primitive ref={root} object={cloned} />;
}

export function SkaterAvatar({ controller }: { controller: RunnerController }) {
  if (!SKATER_GLTF_URL) return <PlaceholderSkater controller={controller} />;
  return (
    <Suspense fallback={<PlaceholderSkater controller={controller} />}>
      <SkaterGltf controller={controller} url={SKATER_GLTF_URL} />
    </Suspense>
  );
}

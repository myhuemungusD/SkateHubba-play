import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import { BLOOM_MIPS, BLOOM_RADIUS, BLOOM_STRENGTH, BLOOM_THRESHOLD } from "../tune";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { logger } from "../../services/logger";

/**
 * One composer for the high tier. UnrealBloomPass builds five half-res
 * mip targets and composites them in that same render, which is the
 * 4–5 mip bloom. The threshold stays near 1 so the asphalt stays dark
 * and the lamps and sparks are what glow. A positive frame priority
 * takes the render from the canvas, so this is the only fullscreen draw.
 */
export function RunnerBloom(): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  const composer = useMemo(() => {
    const effect = new EffectComposer(gl);
    effect.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new Vector2(size.width, size.height),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    if (bloom.nMips !== BLOOM_MIPS) logger.warn("runner_bloom_mip_count_drifted", { nMips: bloom.nMips });
    effect.addPass(bloom);
    effect.addPass(new OutputPass());
    return effect;
  }, [camera, gl, scene, size.height, size.width]);

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size.height, size.width]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame(() => {
    composer.render();
  }, 1);

  return null;
}

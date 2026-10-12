import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * A short halo on the sodium lamps and the grind sparks. High tier only.
 * Strength stays low and the threshold stays high so the street itself
 * does not glow. A positive frame priority takes the render from the
 * canvas, so this pass is the only fullscreen draw.
 */
export function RunnerBloom(): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  const composer = useMemo(() => {
    const effect = new EffectComposer(gl);
    effect.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new Vector2(size.width, size.height), 0.22, 0.36, 0.86);
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
